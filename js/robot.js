import * as THREE from './three.js';
import { HL, HW, G, BALL_R, HUB_TOP, ZONE_X, side, groundHeight } from './config.js';
import { inZone, inRect } from './field.js';
import { buildRobotModel } from './models.js';

const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const rectAxes = (h) => { const c = Math.cos(h), s = Math.sin(h); return [[c, -s], [s, c]]; };
const AABB_AXES = [[1, 0], [0, 1]];
const proj = (axes, hx, hz, ax) =>
  hx * Math.abs(axes[0][0] * ax[0] + axes[0][1] * ax[1]) + hz * Math.abs(axes[1][0] * ax[0] + axes[1][1] * ax[1]);

// Separating axis test between two 2D rectangles. Returns the push that moves A out of B.
export function satRect(ax, az, aAxes, ahx, ahz, bx, bz, bAxes, bhx, bhz) {
  const dx = ax - bx, dz = az - bz;
  let best = Infinity, nx = 0, nz = 0;
  for (const axs of [aAxes, bAxes]) {
    for (const v of axs) {
      const dist = dx * v[0] + dz * v[1];
      const o = proj(aAxes, ahx, ahz, v) + proj(bAxes, bhx, bhz, v) - Math.abs(dist);
      if (o <= 0) return null;
      if (o < best) { best = o; const sg = dist < 0 ? -1 : 1; nx = v[0] * sg; nz = v[1] * sg; }
    }
  }
  return { nx, nz, d: best };
}

// Circle (cx, cz, r) against an oriented rectangle. Returns the push that moves the circle out.
// Flywheel-limited shooters: launch speed needed to drop into the HUB from a horizontal distance d,
// trying a few arc heights (an adjustable hood) and keeping the slowest.
const ARCS = [1.0, 0.6, 1.4, 1.9, 0.35];
function arcSpeed(d, y0, apex) {
  const top = Math.max(HUB_TOP + 0.05, y0) + apex;
  const vy = Math.sqrt(2 * G * (top - y0));
  const T = vy / G + Math.sqrt(2 * (top - HUB_TOP - 0.05) / G);
  return Math.hypot(vy, d / T);
}
// Longest HUB shot (metres) a robot at rest can make with launch speed vmax.
export function shotRange(vmax, y0) {
  let best = 0;
  for (let d = 0.3; d < 12; d += 0.05) if (Math.min(...ARCS.map((a) => arcSpeed(d, y0, a))) <= vmax) best = d;
  return best;
}

function circleRect(cx, cz, r, bx, bz, bh, bhx, bhz) {
  const c = Math.cos(bh), s = Math.sin(bh);
  const dx = cx - bx, dz = cz - bz;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const qx = Math.max(-bhx, Math.min(bhx, lx)), qz = Math.max(-bhz, Math.min(bhz, lz));
  let nlx = lx - qx, nlz = lz - qz;
  let d = Math.hypot(nlx, nlz), depth;
  if (d > 1e-6) {
    if (d >= r) return null;
    nlx /= d; nlz /= d; depth = r - d;
  } else {
    // Centre inside the rectangle: leave along the nearest face.
    const ox = bhx - Math.abs(lx), oz = bhz - Math.abs(lz);
    if (ox < oz) { nlx = Math.sign(lx) || 1; nlz = 0; depth = ox + r; } else { nlx = 0; nlz = Math.sign(lz) || 1; depth = oz + r; }
  }
  return { nx: nlx * c + nlz * s, nz: -nlx * s + nlz * c, d: depth };
}

// Push that separates shape a from shape b. Shapes: {x, z, h, round, hl, hw}.
function separate(a, b) {
  if (a.round && b.round) {
    const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), o = a.hl + b.hl - d;
    if (o <= 0) return null;
    return d > 1e-6 ? { nx: dx / d, nz: dz / d, d: o } : { nx: 1, nz: 0, d: o };
  }
  if (a.round) return circleRect(a.x, a.z, a.hl, b.x, b.z, b.h, b.hl, b.hw);
  if (b.round) {
    const r = circleRect(b.x, b.z, b.hl, a.x, a.z, a.h, a.hl, a.hw);
    return r && { nx: -r.nx, nz: -r.nz, d: r.d };
  }
  return satRect(a.x, a.z, rectAxes(a.h), a.hl, a.hw, b.x, b.z, b.h ? rectAxes(b.h) : AABB_AXES, b.hl, b.hw);
}

export class Robot {
  constructor(id, alliance, number, preset, isPlayer) {
    this.id = id;
    this.alliance = alliance;
    this.number = number;
    this.p = { ...preset };
    this.isPlayer = isPlayer;
    this.round = this.p.shape === 'round';
    this.x = 0; this.z = 0; this.h = 0; this.y = 0;
    this.vx = 0; this.vz = 0; this.w = 0;
    this.fuel = 0;
    this.fireT = 0;
    this.contactT = 0;
    this.intakeT = 0;
    this.passTarget = null;
    this.boost = 1;
    this.deploy = 0;               // 0..1 for linear-slide intakes
    this.nextTurret = 0;
    this.turrets = this.p.turrets.map((t) => ({ ...t, angle: t.fixed ?? 0, err: 9, shot: null }));
    this.fixedShooter = this.turrets.some((t) => t.fixed !== undefined);
    // Builder robots can have a launch speed limit; the rest reach the HUB from anywhere.
    this.maxRange = this.p.shotSpeed ? shotRange(this.p.shotSpeed, (this.p.height ?? 0.5) + 0.1) : Infinity;
    this.outOfRange = false;
    this.climbLevel = 0;           // level currently held
    this.climbTarget = 0;
    this.climbY = 0;
    this.stats = { shots: 0, passes: 0, scored: 0, intaked: 0 };
    this.aimMode = 'hub';
    this.normal = new THREE.Vector3(0, 1, 0);
    this.parts = buildRobotModel(this);
    this.mesh = this.parts.group;
  }

  get shape() { return { x: this.x, z: this.z, h: this.h, round: this.round, hl: this.p.halfL, hw: this.p.halfW }; }

  place(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    this.vx = this.vz = this.w = 0;
    this.climbLevel = 0; this.climbTarget = 0; this.climbY = 0;
    for (const t of this.turrets) t.angle = t.fixed ?? 0;
  }

  get climbing() { return this.climbTarget > 0 || this.climbY > 0.001; }

  fwd() { return [Math.cos(this.h), -Math.sin(this.h)]; }

  toLocal(x, z) {
    const dx = x - this.x, dz = z - this.z, c = Math.cos(this.h), s = Math.sin(this.h);
    return [dx * c - dz * s, dx * s + dz * c];
  }

  toWorld(lx, lz) {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    return [this.x + lx * c + lz * s, this.z - lx * s + lz * c];
  }

  inClimbZone(world) {
    const t = world.towers[this.alliance];
    return inRect(t.zone, this.x, this.z);
  }

  // Ask to climb to the next level (or a specific one).
  requestClimb(world, level) {
    const m = world.match;
    const maxL = m.phase === 'auto' ? Math.min(1, this.p.climbMax) : this.p.climbMax;
    const target = Math.min(maxL, level ?? this.climbTarget + 1);
    if (target <= this.climbTarget) return false;
    if (!this.climbing && !this.inClimbZone(world)) return false;
    if (!this.climbing && Math.hypot(this.vx, this.vz) > 1.2) return false;
    this.climbTarget = target;
    return true;
  }

  descend() {
    if (this.climbTarget > 0) this.climbTarget -= 1;
  }

  // Chassis heading that points a fixed shooter at its target (null for turrets).
  aimHeading() {
    const t = this.turrets.find((u) => u.fixed !== undefined);
    return t && t.shot ? t.shot.yaw - t.fixed : null;
  }

  // cmd: {mx, mz} field-relative drive in [-1,1], rot in [-1,1] or heading target, intake, shoot.
  update(dt, cmd, world, enabled) {
    const s = side(this.alliance);
    if (!enabled) cmd = { mx: 0, mz: 0, rot: 0, intake: false, shoot: false };

    // --- Climbing: lock to the tower, animate up/down.
    const t = world.towers[this.alliance];
    if (this.climbing) {
      const tz = Math.max(t.z - 0.4, Math.min(t.z + 0.4, this.z));
      const goalH = s > 0 ? 0 : Math.PI;
      const cx = t.climbX - s * (this.p.halfL - 0.435);
      this.x += (cx - this.x) * Math.min(1, dt * 6);
      this.z += (tz - this.z) * Math.min(1, dt * 6);
      this.h += wrap(goalH - this.h) * Math.min(1, dt * 6);
      this.vx = this.vz = this.w = 0;
      this.driving = false;
      const goalY = this.climbTarget > 0 ? t.rungs[this.climbTarget - 1] - 0.48 : 0;
      const rate = this.p.climbRate;
      if (this.climbY < goalY) this.climbY = Math.min(goalY, this.climbY + rate * dt);
      else this.climbY = Math.max(goalY, this.climbY - rate * 1.5 * dt);
      this.climbLevel = this.climbTarget > 0 && Math.abs(this.climbY - goalY) < 0.01 ? this.climbTarget : 0;
      this.parts.hook.scale.y = Math.max(0.01, (this.climbTarget > 0 ? t.rungs[this.climbTarget - 1] : 0.2) - this.climbY - this.parts.hook.position.y + 0.05);
    } else {
      this.climbLevel = 0;
      this.parts.hook.scale.y = 0.01;
      // --- Swerve drive.
      let mx = cmd.mx || 0, mz = cmd.mz || 0;
      const mag = Math.hypot(mx, mz);
      this.driving = mag > 0.1;
      if (mag > 1) { mx /= mag; mz /= mag; }
      const vmax = this.p.maxSpeed * (cmd.speedScale ?? 1);
      const tvx = mx * vmax, tvz = mz * vmax;
      let dvx = tvx - this.vx, dvz = tvz - this.vz;
      const dv = Math.hypot(dvx, dvz), amax = this.p.accel * this.boost * dt;
      if (dv > amax) { dvx *= amax / dv; dvz *= amax / dv; }
      this.vx += dvx; this.vz += dvz;

      let tw;
      if (cmd.heading !== undefined && cmd.heading !== null) {
        // Cap the turn rate by the stopping distance so we settle on the heading instead of
        // overshooting back and forth (matters for fixed shooters lining up a shot).
        const err = wrap(cmd.heading - this.h);
        const wMax = this.p.maxOmega * (cmd.speedScale ?? 1);
        const brake = Math.sqrt(2 * this.p.maxOmega * 5 * Math.abs(err)) * 0.85;
        tw = Math.sign(err) * Math.min(wMax, brake, Math.abs(err) * (cmd.headingGain ?? 3) * wMax);
      } else {
        tw = (cmd.rot || 0) * this.p.maxOmega;
      }
      const dwmax = this.p.maxOmega * 5 * dt;
      this.w += Math.max(-dwmax, Math.min(dwmax, tw - this.w));

      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.h += this.w * dt;
    }
    this.h = wrap(this.h);

    this.boost = cmd.boost ?? 1;
    this.intakeOn = !!cmd.intake && !this.climbing;
    this.deploy += ((this.intakeOn ? 1 : 0) - this.deploy) * Math.min(1, dt * 10);
    this.updateTurrets(dt, world);
    this.handleShooting(dt, cmd, world);
  }

  // Static obstacles, walls and other robots.
  collide(world) {
    if (this.climbing) return;
    const resolve = (b) => {
      const r = separate(this.shape, { x: b.x, z: b.z, h: 0, round: false, hl: b.hx, hw: b.hz });
      if (!r) return;
      this.x += r.nx * r.d; this.z += r.nz * r.d;
      const vn = this.vx * r.nx + this.vz * r.nz;
      if (vn < 0) { this.vx -= vn * r.nx; this.vz -= vn * r.nz; }
    };
    for (const b of world.field.boxes) if (b.y0 < this.p.height) resolve(b);
    if (!this.p.fitsTrench) for (const b of world.field.trenchBoxes) resolve(b);

    let ex, ez;
    if (this.round) { ex = ez = this.p.halfL; } else {
      const c = Math.abs(Math.cos(this.h)), sn = Math.abs(Math.sin(this.h));
      ex = this.p.halfL * c + this.p.halfW * sn;
      ez = this.p.halfL * sn + this.p.halfW * c;
    }
    if (this.x > HL - ex) { this.x = HL - ex; this.vx = Math.min(0, this.vx); }
    if (this.x < -HL + ex) { this.x = -HL + ex; this.vx = Math.max(0, this.vx); }
    if (this.z > HW - ez) { this.z = HW - ez; this.vz = Math.min(0, this.vz); }
    if (this.z < -HW + ez) { this.z = -HW + ez; this.vz = Math.max(0, this.vz); }
  }

  static collidePair(a, b) {
    if (a.climbing || b.climbing) return;
    if (Math.abs(a.x - b.x) > 1.5 || Math.abs(a.z - b.z) > 1.5) return;
    const r = separate(a.shape, b.shape);
    if (!r) return;
    // Contact with an opponent throws off shooting for a moment (that's what defense buys).
    if (a.alliance !== b.alliance) { a.contactT = 0.45; b.contactT = 0.45; }
    // A robot that isn't driving holds its ground better than one pushing into it.
    const wa = a.driving ? 1 : 0.35, wb = b.driving ? 1 : 0.35;
    const ka = wa / (wa + wb), kb = 1 - ka;
    a.x += r.nx * r.d * ka; a.z += r.nz * r.d * ka;
    b.x -= r.nx * r.d * kb; b.z -= r.nz * r.d * kb;
    const vn = (a.vx - b.vx) * r.nx + (a.vz - b.vz) * r.nz;
    if (vn < 0) {
      a.vx -= vn * ka * r.nx; a.vz -= vn * ka * r.nz;
      b.vx += vn * kb * r.nx; b.vz += vn * kb * r.nz;
    }
  }

  // Push loose FUEL aside and swallow it through the intake.
  interactFuel(fuel, dt) {
    this.intakeT -= dt;
    const R = BALL_R, p = this.p;
    const c = Math.cos(this.h), s = Math.sin(this.h);
    const top = this.y + this.climbY + p.height;
    const bottom = this.y + this.climbY;
    const front = p.halfL + this.deploy * p.intakeDeploy;
    const reach = Math.max(front, p.halfW) + 0.3;
    fuel.query(this.x - reach, this.z - reach, this.x + reach, this.z + reach, (i) => {
      if (!fuel.active[i] || fuel.shooter[i] === this.id) return;
      const by = fuel.py[i];
      if (by > top + R || by < bottom - R) return;
      const dx = fuel.px[i] - this.x, dz = fuel.pz[i] - this.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;

      const inIntake = lx > p.halfL - 0.15 && lx < front + R && Math.abs(lz) < p.intakeW && by < bottom + 0.35;
      if (inIntake && this.intakeOn) {
        if (this.intakeT <= 0 && this.fuel < p.capacity) {
          fuel.remove(i);
          this.intakeT = 1 / ((p.intakeRate ?? 20) * this.boost);
          this.fuel++;
          this.stats.intaked++;
          return;
        }
      }

      let nx, nz, d;
      if (this.round) {
        const dist = Math.hypot(dx, dz), lim = p.halfL + R;
        if (dist >= lim || dist < 1e-6) return;
        nx = dx / dist; nz = dz / dist; d = lim - dist;
      } else {
        // A deployed intake also acts like part of the frame.
        const fx = inIntake && this.deploy > 0.5 ? front : p.halfL;
        const limZ = p.halfW + R;
        if (lx >= fx + R || lx <= -p.halfL - R || Math.abs(lz) >= limZ) return;
        const ox = lx > 0 ? fx + R - lx : lx + p.halfL + R, oz = limZ - Math.abs(lz);
        let nlx = 0, nlz = 0;
        if (ox < oz) { nlx = Math.sign(lx); d = ox; } else { nlz = Math.sign(lz); d = oz; }
        nx = nlx * c + nlz * s; nz = -nlx * s + nlz * c;
      }
      fuel.px[i] += nx * d; fuel.pz[i] += nz * d;
      const pvx = this.vx + this.w * dz, pvz = this.vz - this.w * dx;
      const rel = (fuel.vx[i] - pvx) * nx + (fuel.vz[i] - pvz) * nz;
      if (rel < 0) { fuel.vx[i] -= rel * 1.2 * nx; fuel.vz[i] -= rel * 1.2 * nz; }
    });
  }

  aimPoint(world) {
    const s = side(this.alliance);
    if (inZone(this.alliance, this.x)) {
      this.aimMode = 'hub';
      const h = world.field.hubs[this.alliance];
      return { x: h.x, y: HUB_TOP + 0.05, z: h.z, apex: 1.0, hub: true };
    }
    // Outside the alliance zone the shooter lobs FUEL back home instead.
    this.aimMode = 'pass';
    if (this.passTarget) return this.passTarget;
    return { x: s * (ZONE_X + 1.6), y: 0.1, z: Math.max(-2.5, Math.min(2.5, this.z * 0.6)), apex: 2.6 };
  }

  turretWorld(t) {
    const [x, z] = this.toWorld(t.x, t.z);
    return { x, z, y: this.y + this.climbY + (t.y ?? this.p.height) + 0.1 };
  }

  // Ballistic solution with fixed apex height, compensating for robot velocity.
  solveShot(tgt, p) {
    const vmax = this.p.shotSpeed;
    if (vmax && tgt.hub) {
      // Flatten or loft the arc if the default one needs more speed than the flywheel gives.
      let best = null;
      for (const a of ARCS) {
        const s = this.solveArc(tgt, p, a);
        s.speed = Math.hypot(s.vx, s.vy, s.vz);
        if (s.speed <= vmax) return s;
        if (!best || s.speed < best.speed) best = s;
      }
      best.out = true;
      return best;
    }
    return this.solveArc(tgt, p, tgt.apex);
  }

  solveArc(tgt, p, arc) {
    const apex = Math.max(tgt.y, p.y) + arc;
    const vy = Math.sqrt(2 * G * (apex - p.y));
    const T = vy / G + Math.sqrt(2 * (apex - tgt.y) / G);
    const hvx = (tgt.x - p.x) / T - this.vx;
    const hvz = (tgt.z - p.z) / T - this.vz;
    return { p, vx: hvx, vy, vz: hvz, T, yaw: Math.atan2(-hvz, hvx), dist: Math.hypot(tgt.x - p.x, tgt.z - p.z) };
  }

  updateTurrets(dt, world) {
    const tgt = this.aimPoint(world);
    for (const t of this.turrets) {
      t.shot = this.solveShot(tgt, this.turretWorld(t));
    }
    this.outOfRange = this.turrets.every((t) => t.shot.out);
    for (const t of this.turrets) {
      const want = wrap(t.shot.yaw - this.h);
      if (t.fixed !== undefined) { t.err = Math.abs(wrap(want - t.fixed)); continue; }
      // Counter-rotate against the chassis so the turret holds aim while the robot spins.
      t.angle -= this.w * dt;
      const err = wrap(want - t.angle);
      const step = 12 * dt;
      t.angle += Math.max(-step, Math.min(step, err));
      t.err = Math.abs(err);
    }
  }

  handleShooting(dt, cmd, world) {
    this.fireT -= dt;
    this.contactT -= dt;
    this.shooting = !!cmd.shoot && this.fuel > 0;
    if (!this.shooting || this.fireT > 0) return;
    // Fixed shooters can't hold their aim while being shoved.
    if (this.contactT > 0 && this.fixedShooter) return;
    // Alternate between shooters that are on target.
    const n = this.turrets.length;
    let t = null;
    for (let k = 0; k < n; k++) {
      const u = this.turrets[(this.nextTurret + k) % n];
      // A fixed shooter fires down its barrel, so it only needs to be close enough to land in
      // the opening (about 30 cm of error at the target).
      const tol = u.fixed !== undefined ? Math.min(0.2, 0.3 / Math.max(1, u.shot ? u.shot.dist : 1)) : 0.08;
      if (u.err < tol && u.shot && !u.shot.out) { t = u; this.nextTurret = (this.nextTurret + k + 1) % n; break; }
    }
    if (!t) return;
    this.fireT = 1 / (this.p.fireRate * this.boost);
    const shot = t.shot;
    const spread = this.p.spread * (cmd.spreadScale ?? 1) * (1 + Math.hypot(this.vx, this.vz) * 0.15) * (this.contactT > 0 ? 3 : 1);
    let yawE = (Math.random() + Math.random() - 1) * spread * 2.5;
    // (the rotation below turns the solution by -yawE, so this lands it on the barrel's yaw)
    if (t.fixed !== undefined) yawE += wrap(shot.yaw - this.h - t.fixed);
    const sp = 1 + (Math.random() + Math.random() - 1) * spread * (1 + shot.dist * 0.25);
    const c = Math.cos(yawE), sn = Math.sin(yawE);
    const vx = (shot.vx * c - shot.vz * sn) * sp, vz = (shot.vx * sn + shot.vz * c) * sp;
    const vy = shot.vy * (1 + (Math.random() - 0.5) * spread * 0.6);
    // Wide drum shooters release FUEL anywhere across their width.
    let ox = 0, oz = 0;
    if (t.width) [ox, oz] = [Math.sin(this.h) * (Math.random() - 0.5) * 2 * t.width, Math.cos(this.h) * (Math.random() - 0.5) * 2 * t.width];
    const i = world.fuel.spawn(shot.p.x + Math.cos(shot.yaw) * 0.12 + ox, shot.p.y, shot.p.z - Math.sin(shot.yaw) * 0.12 + oz, vx + this.vx, vy, vz + this.vz, this.id);
    if (i < 0) return;
    this.fuel--;
    if (this.aimMode === 'pass') this.stats.passes++; else this.stats.shots++;
  }

  // Small floating label (bot role) above the robot; null hides it.
  setTag(text, color = '#ffffff') {
    if (text === this.tagText) return;
    this.tagText = text;
    if (!text) { if (this.tag) this.tag.visible = false; return; }
    if (!this.tag) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      this.tag.scale.set(0.9, 0.225, 1);
      this.tag.renderOrder = 10;
      this.tagCanvas = c;
    }
    const g = this.tagCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(12,14,18,0.78)';
    g.beginPath(); g.roundRect(4, 6, 248, 52, 14); g.fill();
    g.fillStyle = color;
    g.font = 'bold 30px system-ui, "Noto Sans TC", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${this.number} ${text}`, 128, 33);
    this.tag.material.map.needsUpdate = true;
    this.tag.visible = true;
  }

  syncMesh(dt) {
    if (this.tag) {
      if (!this.tag.parent && this.mesh.parent) this.mesh.parent.add(this.tag);
      this.tag.position.set(this.x, this.y + this.climbY + this.p.height + 0.55, this.z);
    }
    // Ride bumps: tilt to the ground normal sampled under the frame.
    const e = 0.35;
    const hxp = groundHeight(this.x + e, this.z), hxm = groundHeight(this.x - e, this.z);
    const hzp = groundHeight(this.x, this.z + e), hzm = groundHeight(this.x, this.z - e);
    const yGround = Math.max(groundHeight(this.x, this.z), (hxp + hxm + hzp + hzm) / 4);
    this.y += (yGround - this.y) * Math.min(1, dt * 20);
    const n = new THREE.Vector3(-(hxp - hxm) / (2 * e), 1, -(hzp - hzm) / (2 * e)).normalize();
    this.normal.lerp(n, Math.min(1, dt * 12)).normalize();
    const qTilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.normal);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.h);
    this.mesh.quaternion.copy(qTilt.multiply(qYaw));
    this.mesh.position.set(this.x, this.y + this.climbY, this.z);

    const P = this.parts;
    this.turrets.forEach((t, i) => { if (P.turrets[i]) P.turrets[i].rotation.y = t.angle; });
    P.fill.mesh.count = Math.min(P.fill.spots, Math.ceil((this.fuel / this.p.capacity) * P.fill.spots));
    if (this.intakeOn) for (const r of P.rollers) r.rotation.y += dt * 30;
    if (P.rotor && (this.intakeOn || this.shooting)) P.rotor.rotation.y += dt * (this.shooting ? 9 : 3);
    if (P.slide) P.slide.position.x = this.deploy * this.p.intakeDeploy;
  }
}
