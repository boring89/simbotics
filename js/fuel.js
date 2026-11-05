import * as THREE from './three.js';
import { HL, HW, G, BALL_R, HUB_TOP, HUB_OPEN_R, HUB_HALF, groundHeight, side, COLORS } from './config.js';

const CELL = BALL_R * 2;
const GX = Math.ceil((HL * 2 + 1) / CELL);
const GZ = Math.ceil((HW * 2 + 1) / CELL);

// All FUEL lives in one fixed pool. Balls that are held by a robot, an OUTPOST or inside
// a HUB are inactive; robots and OUTPOSTs just keep a count.
export class Fuel {
  constructor(scene, total) {
    this.n = total;
    this.px = new Float32Array(total); this.py = new Float32Array(total); this.pz = new Float32Array(total);
    this.vx = new Float32Array(total); this.vy = new Float32Array(total); this.vz = new Float32Array(total);
    this.active = new Uint8Array(total);
    this.shooter = new Int16Array(total).fill(-1); // robot id while a shot is in flight
    this.free = [];
    for (let i = total - 1; i >= 0; i--) this.free.push(i);

    this.cellHead = new Int32Array(GX * GZ);
    this.next = new Int32Array(total);

    const geo = new THREE.SphereGeometry(BALL_R, 14, 10);
    const mat = new THREE.MeshStandardMaterial({ color: COLORS.fuel, roughness: 0.55, emissive: 0x2a2000 });
    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.hubQueue = [];
  }

  spawn(x, y, z, vx = 0, vy = 0, vz = 0, shooter = -1) {
    const i = this.free.pop();
    if (i === undefined) return -1;
    this.active[i] = 1;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.shooter[i] = shooter;
    return i;
  }

  remove(i) {
    if (!this.active[i]) return;
    this.active[i] = 0;
    this.shooter[i] = -1;
    this.free.push(i);
  }

  cellOf(x, z) {
    const cx = Math.floor((x + HL + 0.5) / CELL), cz = Math.floor((z + HW + 0.5) / CELL);
    if (cx < 0 || cz < 0 || cx >= GX || cz >= GZ) return -1;
    return cx * GZ + cz;
  }

  rebuildGrid() {
    this.cellHead.fill(-1);
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      const c = this.cellOf(this.px[i], this.pz[i]);
      if (c < 0) { this.next[i] = -1; continue; }
      this.next[i] = this.cellHead[c];
      this.cellHead[c] = i;
    }
  }

  // Calls fn(i) for each active ball whose grid cell overlaps the given AABB.
  query(x0, z0, x1, z1, fn) {
    const cx0 = Math.max(0, Math.floor((x0 + HL + 0.5) / CELL)), cx1 = Math.min(GX - 1, Math.floor((x1 + HL + 0.5) / CELL));
    const cz0 = Math.max(0, Math.floor((z0 + HW + 0.5) / CELL)), cz1 = Math.min(GZ - 1, Math.floor((z1 + HW + 0.5) / CELL));
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let i = this.cellHead[cx * GZ + cz]; i !== -1; i = this.next[i]) fn(i);
      }
    }
  }

  // onHub(alliance, ballIndex) is called when a ball drops through a HUB opening.
  step(dt, boxes, hubs, onHub, time) {
    const { px, py, pz, vx, vy, vz, active } = this;
    const R = BALL_R;

    for (let i = 0; i < this.n; i++) {
      if (!active[i]) continue;
      const prevY = py[i];
      const gh = groundHeight(px[i], pz[i]);
      const onGround = py[i] <= gh + R + 0.002;

      vy[i] -= G * dt;
      if (onGround) {
        // Roll down bump slopes and lose speed to the carpet.
        if (gh > 0) {
          const e = 0.04;
          const gx = (groundHeight(px[i] + e, pz[i]) - groundHeight(px[i] - e, pz[i])) / (2 * e);
          const gz = (groundHeight(px[i], pz[i] + e) - groundHeight(px[i], pz[i] - e)) / (2 * e);
          vx[i] -= G * gx * dt * 0.7;
          vz[i] -= G * gz * dt * 0.7;
        }
        const f = Math.exp(-1.2 * dt);
        vx[i] *= f; vz[i] *= f;
        if (vx[i] * vx[i] + vz[i] * vz[i] < 0.0009) { vx[i] = 0; vz[i] = 0; }
      }
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;

      const g2 = groundHeight(px[i], pz[i]);
      if (py[i] < g2 + R) {
        py[i] = g2 + R;
        if (vy[i] < 0) vy[i] = vy[i] < -0.8 ? -vy[i] * 0.35 : 0;
        if (this.shooter[i] >= 0 && vy[i] === 0) this.shooter[i] = -1;
      }

      // Perimeter.
      if (px[i] > HL - R) { px[i] = HL - R; if (vx[i] > 0) vx[i] *= -0.4; }
      else if (px[i] < -HL + R) { px[i] = -HL + R; if (vx[i] < 0) vx[i] *= -0.4; }
      if (pz[i] > HW - R) { pz[i] = HW - R; if (vz[i] > 0) vz[i] *= -0.4; }
      else if (pz[i] < -HW + R) { pz[i] = -HW + R; if (vz[i] < 0) vz[i] *= -0.4; }

      // HUB openings.
      let scored = false;
      for (const a in hubs) {
        const h = hubs[a];
        const dx = px[i] - h.x, dz = pz[i] - h.z;
        if (prevY >= HUB_TOP && py[i] < HUB_TOP && dx * dx + dz * dz < HUB_OPEN_R * HUB_OPEN_R) {
          onHub(a, i);
          this.remove(i);
          this.hubQueue.push({ alliance: a, t: time + 0.5 + Math.random() * 0.6 });
          scored = true;
          break;
        }
      }
      if (scored) continue;

      // Static boxes.
      for (let b = 0; b < boxes.length; b++) {
        const s = boxes[b];
        const dx = px[i] - s.x, dz = pz[i] - s.z;
        const ox = s.hx + R - Math.abs(dx), oz = s.hz + R - Math.abs(dz);
        if (ox <= 0 || oz <= 0) continue;
        if (py[i] - R > s.y1 || py[i] + R < s.y0) continue;
        if (s.kind === 'hub' && py[i] > s.y1 - 0.3 && dx * dx + dz * dz < HUB_OPEN_R * HUB_OPEN_R) continue;
        if (prevY - R >= s.y1 - 0.02) {
          py[i] = s.y1 + R;
          if (vy[i] < 0) vy[i] = -vy[i] * 0.3;
          // Nudge off the top so balls don't park on structures.
          vx[i] += Math.sign(dx || 1) * 0.6 * dt * 10; vz[i] += Math.sign(dz || 1) * 0.6 * dt * 10;
        } else if (ox < oz) {
          px[i] += Math.sign(dx) * ox;
          if (vx[i] * dx < 0) vx[i] *= -0.4;
        } else {
          pz[i] += Math.sign(dz) * oz;
          if (vz[i] * dz < 0) vz[i] *= -0.4;
        }
      }
    }

    // Ball-ball contacts.
    this.rebuildGrid();
    const D = 2 * R, D2 = D * D;
    for (let i = 0; i < this.n; i++) {
      if (!active[i]) continue;
      const cx = Math.floor((px[i] + HL + 0.5) / CELL), cz = Math.floor((pz[i] + HW + 0.5) / CELL);
      for (let ax = cx - 1; ax <= cx + 1; ax++) {
        if (ax < 0 || ax >= GX) continue;
        for (let az = cz - 1; az <= cz + 1; az++) {
          if (az < 0 || az >= GZ) continue;
          for (let j = this.cellHead[ax * GZ + az]; j !== -1; j = this.next[j]) {
            if (j <= i) continue;
            const dx = px[i] - px[j], dy = py[i] - py[j], dz = pz[i] - pz[j];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= D2 || d2 < 1e-10) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d, nz = dz / d;
            const push = (D - d) * 0.5;
            px[i] += nx * push; py[i] += ny * push; pz[i] += nz * push;
            px[j] -= nx * push; py[j] -= ny * push; pz[j] -= nz * push;
            const vn = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny + (vz[i] - vz[j]) * nz;
            if (vn < 0) {
              const imp = -0.6 * vn;
              vx[i] += imp * nx; vy[i] += imp * ny; vz[i] += imp * nz;
              vx[j] -= imp * nx; vy[j] -= imp * ny; vz[j] -= imp * nz;
            }
          }
        }
      }
    }

    // Scored FUEL comes back out of the HUB exits into the neutral zone.
    for (let k = this.hubQueue.length - 1; k >= 0; k--) {
      const q = this.hubQueue[k];
      if (q.t > time) continue;
      this.hubQueue.splice(k, 1);
      const h = hubs[q.alliance];
      const s = -side(q.alliance);
      const z = h.z + (Math.random() < 0.5 ? -0.33 : 0.33) + (Math.random() - 0.5) * 0.2;
      this.spawn(h.x + s * (HUB_HALF + 0.1), 0.2, z, s * (1.2 + Math.random() * 1.8), 0.2, (Math.random() - 0.5) * 2.0);
    }
  }

  render() {
    const a = this.mesh.instanceMatrix.array;
    for (let i = 0; i < this.n; i++) {
      const o = i * 16;
      const s = this.active[i] ? 1 : 0;
      a[o] = s; a[o + 5] = s; a[o + 10] = s; a[o + 15] = 1;
      a[o + 12] = this.px[i]; a[o + 13] = this.py[i]; a[o + 14] = this.pz[i];
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
