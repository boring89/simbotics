import * as THREE from './three.js';
import {
  FIELD_L, FIELD_W, HL, HW, HUB_X, HUB_HALF, HUB_TOP, ZONE_X, BUMP, TRENCH,
  TOWER, DEPOT, OUTPOST, COLORS, side, groundHeight,
} from './config.js';

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...opts });

function box(w, h, d, material, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function strip(x, z, w, d, color, parent, y = 0.003) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Builds every static field element and returns collision data used by the physics.
export function buildField(scene) {
  const root = new THREE.Group();
  scene.add(root);

  const boxes = [];      // static axis-aligned boxes: {x, z, hx, hz, y0, y1, kind, alliance}
  const trenchBoxes = []; // only collide with robots that are too tall
  const hubs = {};
  const towers = {};
  const outposts = {};

  // Floor outside the field and carpet.
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), std(0x1b1d22, { roughness: 1 }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.01;
  outside.receiveShadow = true;
  root.add(outside);

  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_L, FIELD_W), std(0x55585e, { roughness: 1 }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.receiveShadow = true;
  root.add(carpet);

  // Tape lines.
  strip(0, 0, 0.05, FIELD_W, 0xffffff, root);
  for (const a of ['red', 'blue']) {
    const s = side(a);
    // Alliance zone line along the alliance-side edge of the BUMP/TRENCH band.
    strip(s * (HUB_X + BUMP.depth / 2 + 0.025), 0, 0.05, FIELD_W, COLORS[a], root);
    // Neutral-zone FUEL pen guides: 38 in from the centre line, 103 in either side of centre.
    strip(s * (0.965 + 0.05), 0, 0.05, 2 * 2.616, 0x111111, root);
  }

  // Perimeter: polycarbonate side walls with aluminium rails.
  const poly = new THREE.MeshStandardMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0.12, roughness: 0.1 });
  const alu = std(0x9aa0a8, { metalness: 0.6, roughness: 0.4 });
  for (const sz of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(FIELD_L, 0.5, 0.02), poly);
    wall.position.set(0, 0.25, sz * (HW + 0.01));
    root.add(wall);
    box(FIELD_L, 0.04, 0.05, alu, 0, 0.5, sz * (HW + 0.02), root);
    box(FIELD_L, 0.12, 0.05, std(0x2a2d33), 0, 0.06, sz * (HW + 0.02), root);
  }

  for (const a of ['red', 'blue']) {
    const s = side(a);
    const col = COLORS[a];
    const dark = a === 'red' ? COLORS.redDark : COLORS.blueDark;
    const allianceMat = std(col, { roughness: 0.5 });
    const darkMat = std(dark, { roughness: 0.6 });

    // Alliance wall with driver station windows.
    const wx = s * (HL + 0.05);
    box(0.1, 0.9, FIELD_W, darkMat, wx, 0.45, 0, root);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.1, FIELD_W), poly);
    glass.position.set(wx, 1.45, 0);
    root.add(glass);
    for (const dz of [-2.2, 0, 2.2]) {
      box(0.6, 1.0, 1.4, std(0x30343b), s * (HL + 0.5), 0.5, dz, root);
      box(0.04, 0.3, 0.5, std(0x111111, { emissive: col, emissiveIntensity: 0.25 }), s * (HL + 0.21), 1.05, dz, root);
    }

    // HUB.
    const hub = new THREE.Group();
    hub.position.set(s * HUB_X, 0, 0);
    root.add(hub);
    box(HUB_HALF * 2, 1.25, HUB_HALF * 2, std(0x2c3038), 0, 0.625, 0, hub);
    for (const [px, pz, w, d] of [[HUB_HALF, 0, 0.02, 1.0], [-HUB_HALF, 0, 0.02, 1.0], [0, HUB_HALF, 1.0, 0.02], [0, -HUB_HALF, 1.0, 0.02]]) {
      box(w, 0.7, d, std(0x3d8f9a, { roughness: 0.6 }), px, 0.75, pz, hub);
      box(w + 0.004, 0.12, d + 0.004, allianceMat, px, 1.17, pz, hub);
    }
    // Slanted net above the funnel on the neutral-zone side catches long shots.
    const netMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, transparent: true, opacity: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.35), netMat);
    net.position.set(-s * (HUB_HALF + 0.08), HUB_TOP + 0.62, 0);
    net.rotation.y = Math.PI / 2;
    net.rotation.x = s * 0.18;
    hub.add(net);
    for (const dz of [-0.62, 0.62]) {
      const rod = box(0.03, 1.4, 0.03, std(0x9aa0a8, { metalness: 0.6 }), -s * (HUB_HALF + 0.08), HUB_TOP + 0.62, dz, hub);
      rod.rotation.z = -s * 0.18;
    }
    boxes.push({ x: s * HUB_X - s * (HUB_HALF + 0.12), z: 0, hx: 0.04, hz: 0.62, y0: HUB_TOP, y1: HUB_TOP + 1.3, kind: 'net' });
    // Exit chutes facing the neutral zone.
    for (const dz of [-0.33, 0.33]) box(0.04, 0.22, 0.4, std(0x0b0c0e), -s * (HUB_HALF + 0.01), 0.18, dz, hub);
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.64, 0.42, 0.58, 6, 1, true),
      std(0x9aa0a8, { side: THREE.DoubleSide, metalness: 0.5, roughness: 0.35, transparent: true, opacity: 0.85 }),
    );
    funnel.position.y = HUB_TOP - 0.29;
    funnel.rotation.y = Math.PI / 6;
    hub.add(funnel);
    const ledMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.5, roughness: 0.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 6), ledMat);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = Math.PI / 6;
    ring.position.y = HUB_TOP;
    hub.add(ring);
    const lightBar = box(HUB_HALF * 2 + 0.02, 0.06, HUB_HALF * 2 + 0.02, ledMat, 0, 1.25, 0, hub);
    lightBar.castShadow = false;
    hubs[a] = { alliance: a, x: s * HUB_X, z: 0, ledMat, color: col };
    boxes.push({ x: s * HUB_X, z: 0, hx: HUB_HALF, hz: HUB_HALF, y0: 0, y1: HUB_TOP, kind: 'hub', alliance: a });

    // BUMPs on both sides of the HUB.
    const shape = new THREE.Shape();
    const N = 24;
    shape.moveTo(-BUMP.depth / 2, 0);
    for (let i = 0; i <= N; i++) {
      const u = -BUMP.depth / 2 + (BUMP.depth * i) / N;
      shape.lineTo(u, groundHeight(HUB_X + u, (BUMP.zMin + BUMP.zMax) / 2));
    }
    shape.lineTo(BUMP.depth / 2, 0);
    const bumpGeo = new THREE.ExtrudeGeometry(shape, { depth: BUMP.zMax - BUMP.zMin, bevelEnabled: false });
    for (const sz of [-1, 1]) {
      const bump = new THREE.Mesh(bumpGeo, std(dark, { roughness: 0.8 }));
      bump.position.set(s * HUB_X, 0, sz > 0 ? BUMP.zMin : -BUMP.zMax);
      bump.receiveShadow = true;
      bump.castShadow = true;
      root.add(bump);
      strip(s * HUB_X, sz * (BUMP.zMin + BUMP.zMax) / 2, 0.05, BUMP.zMax - BUMP.zMin, col, root, BUMP.h + 0.004);
    }

    // TRENCHes: a support block at the outer end of each BUMP and one overhead arm out to the side wall.
    for (const sz of [-1, 1]) {
      const zc = sz * (TRENCH.zMin + TRENCH.zMax) / 2;
      const tw = TRENCH.zMax - TRENCH.zMin;
      const tx = s * HUB_X;
      const bz = sz * (BUMP.zMax - 0.16);
      box(0.42, TRENCH.clear + 0.12, 0.32, darkMat, tx, (TRENCH.clear + 0.12) / 2, bz, root);
      boxes.push({ x: tx, z: bz, hx: 0.21, hz: 0.16, y0: 0, y1: TRENCH.clear + 0.12, kind: 'trench-block' });
      box(TRENCH.arm, 0.11, tw + 0.05, allianceMat, tx, TRENCH.clear + 0.055, zc, root);
      // Arm-mounted AprilTag.
      const tag = box(0.02, 0.2, 0.2, std(0xffffff, { roughness: 0.9 }), tx, TRENCH.clear + 0.24, zc, root);
      box(0.022, 0.1, 0.1, std(0x111111), tx, TRENCH.clear + 0.24, zc, root);
      box(0.03, 0.08, 0.03, alu, tx, TRENCH.clear + 0.13, zc, root);
      tag.castShadow = false;
      // Steel skirt along the alliance-side edge.
      strip(s * (HUB_X + BUMP.depth / 2 - 0.03), zc, 0.06, tw, 0x50545b, root);
      trenchBoxes.push({ x: tx, z: zc, hx: TRENCH.arm / 2 + 0.02, hz: tw / 2, y0: 0, y1: TRENCH.clear, kind: 'trench' });
    }

    // TOWER: black baseplate from the wall, two uprights at its far edge, rungs parallel to the wall,
    // braces back to the wall panel.
    const tx = s * TOWER.x, tz = s * TOWER.z;
    const depthT = HL - TOWER.x;
    const base = new THREE.Mesh(new THREE.BoxGeometry(depthT + 0.04, 0.015, TOWER.uprightHalf * 2 + 0.2), std(0x1a1c20, { roughness: 0.9 }));
    base.position.set(s * (HL - depthT / 2), 0.008, tz);
    base.receiveShadow = true;
    root.add(base);
    const rungMat = std(col, { roughness: 0.45, metalness: 0.3 });
    for (const dz of [-TOWER.uprightHalf, TOWER.uprightHalf]) {
      box(0.05, 1.85, 0.05, rungMat, tx, 0.925, tz + dz, root);
      boxes.push({ x: tx, z: tz + dz, hx: 0.03, hz: 0.03, y0: 0, y1: 1.85, kind: 'tower' });
      for (const y of [0.9, 1.35]) {
        const brace = box(depthT, 0.04, 0.04, alu, s * (HL - depthT / 2), y, tz + dz * 0.9, root);
        brace.castShadow = false;
      }
    }
    box(0.04, 1.7, TOWER.uprightHalf * 2 + 0.3, std(0x1d2025), s * (HL - 0.03), 1.05, tz, root);
    box(0.045, 0.7, TOWER.uprightHalf * 2, std(0x3d8f9a), s * (HL - 0.04), 1.45, tz, root);
    for (const h of TOWER.rungs) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, TOWER.rungHalf * 2, 12), rungMat);
      rung.rotation.x = Math.PI / 2;
      rung.position.set(tx, h, tz);
      rung.castShadow = true;
      root.add(rung);
    }
    // Robots climb from the field side, facing the wall.
    towers[a] = {
      alliance: a, x: tx, z: tz, rungs: TOWER.rungs,
      zone: { x0: Math.min(s * (TOWER.x - 1.2), s * (TOWER.x - 0.2)), x1: Math.max(s * (TOWER.x - 1.2), s * (TOWER.x - 0.2)), z0: tz - 0.85, z1: tz + 0.85 },
      climbX: s * (TOWER.x - 0.47),
    };

    // DEPOT (floor bin along the alliance wall).
    const dx0 = s * DEPOT.x0, dx1 = s * DEPOT.x1, dz0 = s * DEPOT.z0, dz1 = s * DEPOT.z1;
    const dcx = (dx0 + dx1) / 2, dcz = (dz0 + dz1) / 2;
    const dw = Math.abs(dx1 - dx0), dd = Math.abs(dz1 - dz0);
    for (const [cx, cz, w, d] of [[dcx, dz0, dw, 0.03], [dcx, dz1, dw, 0.03], [s * DEPOT.x0, dcz, 0.03, dd]]) {
      box(w, 0.03, d, allianceMat, cx, 0.015, cz, root);
    }

    // OUTPOST: behind the alliance wall in the corner; FUEL rolls in through an opening in the wall.
    const ocz = s * OUTPOST.z;
    const oz1 = s * HW, ow = Math.abs(oz1 - ocz) + OUTPOST.halfW;
    const ox = s * (HL + 0.1 + OUTPOST.depth / 2), ozc = (ocz - s * OUTPOST.halfW + oz1) / 2;
    box(OUTPOST.depth, 0.45, ow, std(0x30343b), ox, 0.225, ozc, root);
    const ramp = box(OUTPOST.depth, 0.03, OUTPOST.halfW * 2, alu, ox, 0.5, ocz, root);
    ramp.rotation.z = s * 0.25;
    for (const dz of [-1, 1]) box(OUTPOST.depth, 0.25, 0.03, allianceMat, ox, 0.62, ocz + dz * OUTPOST.halfW, root);
    // Balls staged on the ramp so the stock is visible.
    const stockMat = std(COLORS.fuel, { roughness: 0.6 });
    const stockG = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.074, 10, 8), stockMat);
      b.position.set(ox + s * (-0.2 + (i % 4) * 0.15), 0.6 + (i % 4) * 0.04, ocz + (Math.floor(i / 4) - 1) * 0.15);
      stockG.add(b);
    }
    root.add(stockG);
    box(0.035, 0.26, OUTPOST.halfW * 2, std(0x0b0c0e), s * (HL + 0.1), 0.16, ocz, root);
    outposts[a] = {
      alliance: a, stock: 0, feedT: 0, stockG,
      mouth: { x: s * (HL - 0.1), y: 0.18, z: ocz },
      dir: { x: -s, z: 0 },
    };
  }

  // Stands and backdrop so the field doesn't float in a void.
  const standMat = std(0x2a2e36);
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      box(FIELD_L + 4, 0.35, 0.8, standMat, 0, 0.6 + i * 0.4, sz * (HW + 2.0 + i * 0.8), root);
    }
  }

  return { root, boxes, trenchBoxes, hubs, towers, outposts };
}

export function inZone(alliance, x) {
  return side(alliance) * x > ZONE_X;
}

export function inRect(r, x, z) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}
