import * as THREE from '../three.js';
import { box, cyl, std, MAT } from './machines.js';
import { PAINT } from '../parts.js';

// The robot on the cart as it gets built: one group per subsystem, shown when that subsystem is
// assembled (or as a see-through ghost while you assemble it). Robot-local: +x = front (intake).

const IN = 0.0254;
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.45, depthWrite: false });

export function buildWip(design, number = 0) {
  const a = design.adv, root = new THREE.Group(), subs = {};
  const round = a.shape === 'round';
  const L = (round ? a.diameter : a.length) * IN, W = (round ? a.diameter : a.width) * IN;
  const accent = std(PAINT[design.color] ?? PAINT.silver, { metalness: 0.5, roughness: 0.4 });
  const alu = MAT.grey, dark = MAT.dark, rubber = MAT.black;
  const H = a.hopperHeight * IN;
  const S = (k) => (subs[k] = new THREE.Group());
  for (const k of ['frame', 'drive', 'intake', 'hopper', 'shooter', 'climber', 'controls', 'bumpers']) root.add(S(k));
  const y0 = 0.07;
  // Frame: 2×1 rails around the perimeter and a belly pan.
  box(L, 0.05, 0.025, alu, 0, y0 + 0.025, W / 2 - 0.013, subs.frame);
  box(L, 0.05, 0.025, alu, 0, y0 + 0.025, -W / 2 + 0.013, subs.frame);
  box(0.025, 0.05, W - 0.05, alu, L / 2 - 0.013, y0 + 0.025, 0, subs.frame);
  box(0.025, 0.05, W - 0.05, alu, -L / 2 + 0.013, y0 + 0.025, 0, subs.frame);
  box(L - 0.06, 0.004, W - 0.06, std(0xcfe8ff, { transparent: true, opacity: 0.35 }), 0, y0, 0, subs.frame);
  // Drive: a module or wheel in each corner.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * (L / 2 - 0.08), z = sz * (W / 2 - 0.08);
    if (a.drive === 'mecanum') cyl(0.05, 0.05, rubber, x, 0.05, z, subs.drive, 'z', 16);
    else {
      box(0.11, 0.06, 0.11, accent, x, y0 + 0.07, z, subs.drive);
      cyl(0.048, 0.04, rubber, x, 0.05, z, subs.drive, 'z', 16);
      cyl(0.028, 0.07, MAT.steel, x, y0 + 0.13, z, subs.drive);
    }
  }
  // Intake at the front.
  const iw = a.intakeWidth * IN, ix = L / 2 + a.intakeExt * IN * 0.6;
  for (const sz of [-1, 1]) box(0.26, 0.09, 0.006, accent, ix - 0.13, 0.12, sz * iw / 2, subs.intake);
  cyl(0.03, iw, rubber, ix - 0.02, 0.08, 0, subs.intake, 'z', 14);
  cyl(0.02, iw, MAT.steel, ix - 0.12, 0.17, 0, subs.intake, 'z', 10);
  // Hopper: clear walls on posts.
  const hx0 = -L / 2 + 0.1, hx1 = L / 2 - 0.12, hz = W / 2 - 0.05;
  const clear = std(0xdfefff, { transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0 });
  for (const sz of [-1, 1]) box(hx1 - hx0, H - 0.12, 0.004, clear, (hx0 + hx1) / 2, 0.12 + (H - 0.12) / 2, sz * hz, subs.hopper);
  for (const [x, z] of [[hx0, hz], [hx0, -hz], [hx1, hz], [hx1, -hz]]) box(0.025, H - 0.12, 0.025, accent, x, 0.12 + (H - 0.12) / 2, z, subs.hopper);
  // Shooters.
  for (const sh of a.shooters) {
    const x = sh.x * IN, z = sh.z * IN;
    if (a.shooterType === 'fixed') {
      const w = sh.width * IN;
      for (const s of [-1, 1]) box(0.2, 0.18, 0.006, dark, x, H - 0.05, z + s * w / 2, subs.shooter);
      cyl(0.05, w, dark, x, H - 0.03, z, subs.shooter, 'z', 16);
    } else {
      cyl(0.13, 0.03, dark, x, H + 0.02, z, subs.shooter, 'y', 24);
      const hood = box(0.22, 0.1, 0.13, accent, x - 0.03, H + 0.1, z, subs.shooter);
      hood.rotation.z = 0.5;
    }
  }
  // Climber arms.
  if (a.climb > 0) {
    const tall = H + [0, 0.1, 0.3, 0.5][a.climb];
    for (const z of a.climb > 1 ? [0.1, -0.1] : [0]) box(0.025, tall - 0.1, 0.025, accent, hx1 - 0.08, 0.1 + (tall - 0.1) / 2, z, subs.climber);
  }
  // Electronics: board with PDH, controller and radio, plus some wire.
  const eb = new THREE.Group();
  eb.position.set(-L / 2 + 0.2, 0.1, 0);
  subs.controls.add(eb);
  box(0.32, 0.004, 0.24, std(0xd8e8f8, { transparent: true, opacity: 0.5 }), 0, 0, 0, eb);
  box(0.12, 0.03, 0.08, MAT.black, -0.06, 0.02, -0.05, eb);
  box(0.08, 0.025, 0.07, std(0xdddddd), 0.08, 0.015, -0.05, eb);
  box(0.06, 0.02, 0.05, MAT.white, 0.08, 0.015, 0.06, eb);
  for (let i = 0; i < 5; i++) box(0.002, 0.004, 0.18, i % 2 ? MAT.red : MAT.black, -0.12 + i * 0.03, 0.01, 0.03, eb);
  // Bumpers with the team number.
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const x = c.getContext('2d');
  x.fillStyle = '#1f5fd6'; x.fillRect(0, 0, 256, 48);
  x.fillStyle = '#fff'; x.font = 'italic 900 38px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(number), 128, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), plain = std(0x1f5fd6, { roughness: 0.85 });
  const bh = 0.13, by = 0.1;
  box(L + 0.17, bh, 0.085, [plain, plain, plain, plain, side, side], 0, by, W / 2 + 0.042, subs.bumpers);
  box(L + 0.17, bh, 0.085, [plain, plain, plain, plain, side, side], 0, by, -W / 2 - 0.042, subs.bumpers);
  box(0.085, bh, W, plain, -L / 2 - 0.042, by, 0, subs.bumpers);
  for (const sz of [-1, 1]) box(0.085, bh, (W - iw) / 2 - 0.02, plain, L / 2 + 0.042, by, sz * (iw / 2 + (W - iw) / 4), subs.bumpers);
  // Keep the real materials so ghosting can swap back.
  root.traverse((o) => { if (o.isMesh) o.userData.mat = o.material; });
  return { group: root, subs, L, W, H };
}

// state: { sub: 'done' | 'ghost' | 'hidden' }
export function showWip(wip, state) {
  for (const [k, g] of Object.entries(wip.subs)) {
    const s = state[k] || 'hidden';
    g.visible = s !== 'hidden';
    g.traverse((o) => { if (o.isMesh) o.material = s === 'ghost' ? ghostMat : o.userData.mat; });
  }
}
