import * as THREE from 'three';
import { COLORS } from './config.js';

// Per-robot 3D models. Each builder fills `g` (robot-local: +x = intake/front, y up)
// and returns the moving parts the Robot animates.

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, ...o });
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

function numberTexture(num, bg, fg = '#ffffff', w = 512, h = 80, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.fillStyle = fg;
  x.font = `italic 900 ${Math.round(h * 0.78)}px system-ui, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (let i = 0; i < repeat; i++) x.fillText(String(num), (w / repeat) * (i + 0.5), h * 0.54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function flagTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const x = c.getContext('2d');
  if (kind === 'tx') {
    x.fillStyle = '#fff'; x.fillRect(0, 0, 96, 32);
    x.fillStyle = '#bf0a30'; x.fillRect(0, 32, 96, 32);
    x.fillStyle = '#002868'; x.fillRect(0, 0, 34, 64);
    x.fillStyle = '#fff'; x.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      x.lineTo(17 + Math.cos(a) * 10, 32 + Math.sin(a) * 10);
    }
    x.fill();
  } else {
    for (let i = 0; i < 7; i++) { x.fillStyle = i % 2 ? '#fff' : '#b22234'; x.fillRect(0, i * 9.2, 96, 9.2); }
    x.fillStyle = '#3c3b6e'; x.fillRect(0, 0, 42, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Kit {
  constructor(g) { this.g = g; }
  mesh(geo, mat, x, y, z, parent = this.g) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  box(w, h, d, mat, x, y, z, parent) { return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent); }
  // Cylinder whose axis is local z (good for rollers spanning the robot width).
  rollerZ(r, len, mat, x, y, z = 0, parent) {
    const m = this.mesh(new THREE.CylinderGeometry(r, r, len, 16), mat, x, y, z, parent);
    m.rotation.x = Math.PI / 2;
    return m;
  }
  cyl(rt, rb, h, mat, x, y, z, parent, seg = 24) { return this.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, parent); }
  panel(w, h, d, x, y, z, parent) {
    const m = this.box(w, h, d, std(0xdfefff, { transparent: true, opacity: 0.17, roughness: 0.05, metalness: 0 }), x, y, z, parent);
    m.castShadow = false;
    return m;
  }
}

// Rectangular bumpers with the team number on every side.
function rectBumpers(k, hl, hw, col, num, fg) {
  const tex = numberTexture(num, hex(col), fg);
  const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const plain = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 });
  const t = 0.085, h = 0.13, y = 0.11;
  const mz = [plain, plain, plain, plain, side, side];
  const mx = [side, side, plain, plain, plain, plain];
  k.box(hl * 2, h, t, mz, 0, y, hw - t / 2);
  k.box(hl * 2, h, t, mz, 0, y, -hw + t / 2);
  k.box(t, h, hw * 2 - 2 * t, mx, hl - t / 2, y, 0);
  k.box(t, h, hw * 2 - 2 * t, mx, -hl + t / 2, y, 0);
}

// Wrap-around bumper for a round frame, open at the front for the intake.
function roundBumper(k, r, col, num, gap) {
  const tex = numberTexture(num, hex(col), '#ffffff', 1024, 64, 3);
  const start = Math.PI / 2 + gap / 2, len = Math.PI * 2 - gap;
  const outer = k.mesh(new THREE.CylinderGeometry(r, r, 0.13, 64, 1, true, start, len), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }), 0, 0.11, 0);
  outer.castShadow = true;
  const plain = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, side: THREE.DoubleSide });
  k.mesh(new THREE.CylinderGeometry(r - 0.085, r - 0.085, 0.13, 64, 1, true, start, len), plain, 0, 0.11, 0);
  const top = k.mesh(new THREE.RingGeometry(r - 0.085, r, 64, 1, start - Math.PI / 2, len), plain, 0, 0.175, 0);
  top.rotation.x = -Math.PI / 2;
}

function hook(k, x, H) {
  const m = k.box(0.04, 1, 0.04, std(0x9aa0a8, { metalness: 0.6 }), x, H, 0);
  m.scale.y = 0.01;
  return m;
}

// Turret group positioned on the robot; child geometry points along +x (shot direction).
function turretGroup(k, t, H) {
  const tg = new THREE.Group();
  tg.position.set(t.x, t.y ?? H, t.z);
  if (t.fixed !== undefined) tg.rotation.y = t.fixed;
  k.g.add(tg);
  return tg;
}

// ---------- Models ----------

function generic(k, r) {
  const { p } = r, H = p.height, col = COLORS[r.alliance];
  const alu = std(0x8c939c, { metalness: 0.6, roughness: 0.4 }), dark = std(0x24272d, { roughness: 0.7 });
  rectBumpers(k, p.halfL, p.halfW, col, r.number);
  k.box(0.68, 0.05, 0.68, dark, 0, 0.1, 0);
  for (const [x, z] of [[0.31, 0.31], [0.31, -0.31], [-0.31, 0.31], [-0.31, -0.31]]) k.box(0.04, H - 0.12, 0.04, alu, x, 0.12 + (H - 0.12) / 2, z);
  k.panel(0.6, H - 0.15, 0.6, -0.02, 0.13 + (H - 0.15) / 2, 0);
  const fill = { x0: -0.3, x1: 0.26, z0: -0.28, z1: 0.28, y0: 0.13, y1: H - 0.04 };
  const roller = k.rollerZ(0.04, p.intakeW * 2, std(0x222222, { roughness: 0.9 }), p.halfL + 0.02, 0.1);
  k.box(0.12, 0.03, p.intakeW * 2 + 0.06, alu, p.halfL - 0.04, 0.17, 0);
  const turrets = p.turrets.map((t) => {
    const tg = turretGroup(k, t, H);
    k.cyl(0.16, 0.17, 0.06, dark, 0, 0, 0, tg, 20);
    const hood = k.box(0.3, 0.14, 0.18, std(col, { roughness: 0.5 }), 0.08, 0.09, 0, tg);
    hood.rotation.z = 0.5;
    return tg;
  });
  return { fill, rollers: [roller], turrets, hook: hook(k, p.halfL - 0.1, H) };
}

// 254 Overload: smoked box hopper, full-width drum shooter at the back, linear slide intake.
function overload(k, r) {
  const { p } = r, H = p.height, hl = p.halfL, hw = p.halfW, col = COLORS[r.alliance];
  const black = std(0x16181c, { roughness: 0.55 }), teamBlue = std(0x1f5fd6, { metalness: 0.4, roughness: 0.4 });
  const silver = std(0xb8bec6, { metalness: 0.8, roughness: 0.25 });
  rectBumpers(k, hl, hw, col, r.number);
  k.box(hl * 2 - 0.14, 0.04, hw * 2 - 0.14, black, 0, 0.09, 0);
  // Blue powder-coated truss rails.
  for (const sz of [-1, 1]) {
    k.box(0.62, 0.05, 0.03, teamBlue, 0.15, 0.2, sz * (hw - 0.1));
    for (let i = 0; i < 4; i++) {
      const d = k.box(0.17, 0.012, 0.025, teamBlue, -0.08 + i * 0.155, 0.2, sz * (hw - 0.1));
      d.rotation.z = i % 2 ? 0.5 : -0.5;
    }
  }
  // Smoked hopper box.
  const hx0 = -0.16, hx1 = hl - 0.03, hy0 = 0.18;
  const smoke = std(0x111418, { transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.3 });
  const hb = k.box(hx1 - hx0, H - hy0, hw * 2 - 0.1, smoke, (hx0 + hx1) / 2, (hy0 + H) / 2, 0);
  hb.castShadow = false;
  for (const [x, z] of [[hx0, hw - 0.05], [hx0, -hw + 0.05], [hx1, hw - 0.05], [hx1, -hw + 0.05]]) k.box(0.02, H - hy0, 0.02, black, x, (hy0 + H) / 2, z);
  k.box(hx1 - hx0, 0.015, 0.02, black, (hx0 + hx1) / 2, H, hw - 0.05);
  k.box(hx1 - hx0, 0.015, 0.02, black, (hx0 + hx1) / 2, H, -hw + 0.05);
  const fill = { x0: hx0 + 0.02, x1: hx1 - 0.02, z0: -hw + 0.08, z1: hw - 0.08, y0: hy0, y1: H };
  // Drum shooter tower at the rear.
  for (const sz of [-1, 1]) {
    k.box(0.3, H - 0.1, 0.02, black, -hl + 0.18, 0.12 + (H - 0.1) / 2, sz * (hw - 0.07));
    const pulley = k.rollerZ(0.1, 0.02, silver, -hl + 0.16, H - 0.2, sz * (hw - 0.045));
    pulley.castShadow = false;
  }
  const drum = k.rollerZ(0.07, hw * 2 - 0.16, black, -hl + 0.16, H - 0.06);
  k.rollerZ(0.04, hw * 2 - 0.16, black, -hl + 0.3, H - 0.02);
  const hood = k.box(0.24, 0.015, hw * 2 - 0.16, black, -hl + 0.08, H + 0.05, 0);
  hood.rotation.z = -0.7;
  k.box(0.05, 0.05, hw * 2 - 0.06, teamBlue, -hl + 0.16, H + 0.02, 0);
  // Linear intake on racks: slides out the front.
  const slide = new THREE.Group();
  k.g.add(slide);
  for (const sz of [-1, 1]) k.box(0.42, 0.04, 0.03, black, hl - 0.15, 0.07, sz * (hw - 0.12), slide);
  const roller = k.rollerZ(0.035, hw * 2 - 0.12, silver, hl + 0.02, 0.06, 0, slide);
  k.rollerZ(0.02, hw * 2 - 0.12, silver, hl - 0.06, 0.13, 0, slide);
  const turrets = p.turrets.map((t) => turretGroup(k, t, H));
  return { fill, rollers: [roller, drum], slide, turrets, hook: hook(k, hl - 0.25, H) };
}

// 1690 Kepler: low, wide, clear walls, electronics deck, side turret with geared wheel.
function kepler(k, r) {
  const { p } = r, H = p.height, hl = p.halfL, hw = p.halfW, col = COLORS[r.alliance];
  const alu = std(0xc0c5cc, { metalness: 0.7, roughness: 0.3 }), black = std(0x15171a);
  rectBumpers(k, hl, hw, col, r.number);
  k.box(hl * 2 - 0.14, 0.04, hw * 2 - 0.14, black, 0, 0.09, 0);
  const y0 = 0.18;
  k.panel(hl * 2 - 0.16, H - y0, 0.01, 0, (y0 + H) / 2, hw - 0.08);
  k.panel(hl * 2 - 0.16, H - y0, 0.01, 0, (y0 + H) / 2, -hw + 0.08);
  k.panel(0.01, H - y0, hw * 2 - 0.16, -hl + 0.08, (y0 + H) / 2, 0);
  for (const [x, z] of [[hl - 0.08, hw - 0.08], [hl - 0.08, -hw + 0.08], [-hl + 0.08, hw - 0.08], [-hl + 0.08, -hw + 0.08], [0, hw - 0.08], [0, -hw + 0.08]]) {
    k.box(0.03, H - y0, 0.03, alu, x, (y0 + H) / 2, z);
  }
  k.box(hl * 2 - 0.16, 0.025, 0.025, alu, 0, H, hw - 0.08);
  k.box(hl * 2 - 0.16, 0.025, 0.025, alu, 0, H, -hw + 0.08);
  // Electronics / wiring cluster at the front-left and the green status LED strip.
  for (const [x, y, z, w, h, d] of [[0.12, 0.3, -0.18, 0.18, 0.16, 0.18], [0.24, 0.36, -0.06, 0.1, 0.14, 0.12], [0.05, 0.38, -0.3, 0.12, 0.1, 0.1]]) k.box(w, h, d, black, x, y, z);
  const led = k.box(0.02, 0.02, hw * 2 - 0.2, new THREE.MeshStandardMaterial({ color: 0x39ff6a, emissive: 0x39ff6a, emissiveIntensity: 1.6 }), hl - 0.08, 0.3, 0);
  led.castShadow = false;
  const fill = { x0: -hl + 0.1, x1: hl - 0.12, z0: -hw + 0.1, z1: hw - 0.1, y0, y1: H + 0.04 };
  // Many-roller intake.
  const rollers = [0.07, 0.15, 0.23].map((y, i) => k.rollerZ(0.03, p.intakeW * 2, black, hl + 0.02 - i * 0.03, y));
  const turrets = p.turrets.map((t) => {
    const tg = turretGroup(k, t, H);
    k.cyl(0.15, 0.15, 0.04, black, 0, 0, 0, tg, 28);
    for (const sz of [-1, 1]) k.box(0.22, 0.14, 0.012, alu, 0.02, 0.08, sz * 0.07, tg);
    const wheel = k.mesh(new THREE.TorusGeometry(0.06, 0.016, 8, 24), std(0xd92b2b, { roughness: 0.5 }), 0.04, 0.09, 0, tg);
    k.rollerZ(0.05, 0.1, std(0x30343a, { metalness: 0.5 }), 0.04, 0.09, 0, tg);
    const hood = k.box(0.16, 0.012, 0.13, black, 0.1, 0.15, 0, tg);
    hood.rotation.z = 0.45;
    void wheel;
    return tg;
  });
  return { fill, rollers, turrets, hook: hook(k, hl - 0.15, H) };
}

// 4946 The Alpha Dogs: round frame, clear cylindrical wall, dye rotor, central shooter tower.
function alphadogs(k, r) {
  const { p } = r, H = p.height, R = p.halfL, col = COLORS[r.alliance];
  const alu = std(0xc8ccd2, { metalness: 0.7, roughness: 0.3 }), black = std(0x15171a), gray = std(0x5b6068);
  const gap = 1.25;
  roundBumper(k, R, col, r.number, gap);
  k.cyl(R - 0.07, R - 0.07, 0.04, black, 0, 0.09, 0, undefined, 48);
  const rotor = new THREE.Group();
  rotor.position.y = 0.14;
  k.g.add(rotor);
  k.cyl(0.34, 0.34, 0.02, gray, 0, 0, 0, rotor, 40);
  for (let i = 0; i < 6; i++) {
    const s = k.box(0.3, 0.05, 0.015, std(0xd9e6f5, { transparent: true, opacity: 0.5 }), 0, 0.03, 0, rotor);
    s.rotation.y = (i * Math.PI) / 3;
    s.position.set(Math.cos((i * Math.PI) / 3) * 0.17, 0.03, -Math.sin((i * Math.PI) / 3) * 0.17);
  }
  const start = Math.PI / 2 + gap / 2;
  const wall = k.mesh(new THREE.CylinderGeometry(0.4, 0.4, H - 0.1, 48, 1, true, start, Math.PI * 2 - gap),
    std(0xdfefff, { transparent: true, opacity: 0.18, roughness: 0.05, side: THREE.DoubleSide }), 0, 0.15 + (H - 0.1) / 2, 0);
  wall.castShadow = false;
  const fill = { r0: 0.13, r1: 0.39, y0: 0.16, y1: H - 0.02 };
  // Central black tower with bearing rings.
  k.cyl(0.11, 0.13, H - 0.1, black, 0, 0.15 + (H - 0.1) / 2, 0);
  for (const y of [0.32, 0.44]) k.mesh(new THREE.TorusGeometry(0.12, 0.008, 6, 32), alu, 0, y, 0).rotation.x = Math.PI / 2;
  // Front intake frame and top truss.
  for (const sz of [-1, 1]) k.box(0.03, H - 0.05, 0.03, alu, 0.27, 0.12 + (H - 0.05) / 2, sz * 0.27);
  k.box(0.03, 0.03, 0.57, alu, 0.27, H + 0.05, 0);
  k.box(0.3, 0.03, 0.03, alu, 0.12, H + 0.05, -0.27);
  k.box(0.03, 0.03, 0.3, alu, -0.02, H + 0.05, -0.13);
  const shield = k.panel(0.02, H - 0.15, 0.5, 0.36, 0.16 + (H - 0.15) / 2, 0);
  shield.rotation.z = 0.12;
  const roller = k.rollerZ(0.04, 0.5, std(0x45c04a, { roughness: 0.8 }), R - 0.03, 0.07);
  k.rollerZ(0.015, 0.54, alu, R - 0.1, 0.22);
  const turrets = p.turrets.map((t) => {
    const tg = turretGroup(k, t, H);
    k.mesh(new THREE.TorusGeometry(0.14, 0.016, 8, 40), black, 0, 0, 0, tg).rotation.x = Math.PI / 2;
    k.cyl(0.13, 0.13, 0.03, std(0x2e3238), 0, 0, 0, tg, 32);
    k.box(0.12, 0.08, 0.1, black, -0.05, 0.05, 0.06, tg);
    const hood = k.box(0.2, 0.012, 0.12, std(0x2a2d33), 0.07, 0.07, 0, tg);
    hood.rotation.z = 0.5;
    k.rollerZ(0.04, 0.1, std(0x6b7079, { metalness: 0.5 }), 0.02, 0.05, 0, tg);
    return tg;
  });
  return { fill, rollers: [roller], rotor, turrets, hook: hook(k, 0.2, H) };
}

// 118 Artemis: white truss sides, gold deck, tall clear hopper, twin turrets with flags.
function artemis(k, r) {
  const { p } = r, H = p.height, hl = p.halfL, hw = p.halfW, col = COLORS[r.alliance];
  const white = std(0xf1f2f4, { roughness: 0.5 }), gold = std(0xc9a243, { metalness: 0.8, roughness: 0.3 });
  const black = std(0x17191c), alu = std(0xc0c5cc, { metalness: 0.7, roughness: 0.3 });
  rectBumpers(k, hl, hw, col, r.number, '#e2b23a');
  k.box(hl * 2 - 0.14, 0.04, hw * 2 - 0.14, black, 0, 0.09, 0);
  for (const sz of [-1, 1]) {
    k.box(hl * 2 - 0.12, 0.12, 0.02, white, 0, 0.25, sz * (hw - 0.07));
    for (let i = 0; i < 6; i++) {
      const d = k.box(0.16, 0.008, 0.022, std(0xcfd3d8), -hl + 0.15 + i * 0.13, 0.25, sz * (hw - 0.075));
      d.rotation.z = i % 2 ? 0.7 : -0.7;
    }
  }
  k.box(0.02, 0.12, hw * 2 - 0.14, white, hl - 0.07, 0.25, 0);
  k.box(hl * 2 - 0.12, 0.02, hw * 2 - 0.12, gold, 0, 0.32, 0);
  // Tall clear hopper at the back half.
  const hx0 = -hl + 0.07, hx1 = 0.05, y0 = 0.33;
  const hcx = (hx0 + hx1) / 2;
  k.panel(hx1 - hx0, H - y0, 0.01, hcx, (y0 + H) / 2, hw - 0.07);
  k.panel(hx1 - hx0, H - y0, 0.01, hcx, (y0 + H) / 2, -hw + 0.07);
  k.panel(0.01, H - y0, hw * 2 - 0.14, hx0, (y0 + H) / 2, 0);
  k.panel(0.01, (H - y0) * 0.6, hw * 2 - 0.14, hx1, y0 + (H - y0) * 0.7, 0);
  for (const [x, z] of [[hx0, hw - 0.07], [hx0, -hw + 0.07], [hx1, hw - 0.07], [hx1, -hw + 0.07]]) k.box(0.025, H - y0, 0.025, alu, x, (y0 + H) / 2, z);
  const fill = { x0: hx0 + 0.02, x1: hx1 - 0.02, z0: -hw + 0.09, z1: hw - 0.09, y0, y1: H + 0.06 };
  // Camera mast in the middle.
  k.box(0.05, 0.22, 0.05, black, 0.18, 0.44, 0);
  k.box(0.08, 0.05, 0.1, black, 0.2, 0.56, 0);
  const roller = k.rollerZ(0.035, p.intakeW * 2, black, hl + 0.02, 0.08);
  const flags = ['tx', 'us'];
  const turrets = p.turrets.map((t, i) => {
    const tg = turretGroup(k, t, H);
    k.cyl(0.13, 0.13, 0.04, black, 0, 0, 0, tg, 28);
    const shroud = k.mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.18, 28, 1, true, Math.PI * 0.75, Math.PI * 1.5),
      std(0xe9ebee, { side: THREE.DoubleSide }), 0, 0.11, 0, tg);
    shroud.castShadow = true;
    k.rollerZ(0.055, 0.1, std(0x2b2e33, { metalness: 0.4 }), 0.0, 0.11, 0, tg);
    const hood = k.box(0.14, 0.012, 0.12, black, 0.07, 0.19, 0, tg);
    hood.rotation.z = 0.5;
    const flag = k.mesh(new THREE.PlaneGeometry(0.1, 0.066), new THREE.MeshBasicMaterial({ map: flagTexture(flags[i % 2]), side: THREE.DoubleSide }), -0.132, 0.12, 0, tg);
    flag.rotation.y = -Math.PI / 2;
    flag.castShadow = false;
    return tg;
  });
  return { fill, rollers: [roller], turrets, hook: hook(k, 0, 0.34) };
}

// 4414 RIPCURRENT: panelled box, dolphin-tail dye rotor, flat pancake turret.
function ripcurrent(k, r) {
  const { p } = r, H = p.height, hl = p.halfL, hw = p.halfW, col = COLORS[r.alliance];
  const panelM = std(0x3a3e45, { roughness: 0.55, metalness: 0.3 }), teal = std(0x17b6a6, { roughness: 0.4 });
  const black = std(0x16181b), gray = std(0x8d939b, { metalness: 0.6, roughness: 0.35 });
  rectBumpers(k, hl, hw, col, r.number);
  k.box(hl * 2 - 0.14, 0.04, hw * 2 - 0.14, black, 0, 0.09, 0);
  const y0 = 0.17;
  for (const sz of [-1, 1]) {
    k.box(hl * 2 - 0.1, H - y0, 0.015, panelM, 0, (y0 + H) / 2, sz * (hw - 0.06));
    k.box(hl * 2 - 0.1, 0.02, 0.025, teal, 0, H, sz * (hw - 0.06));
  }
  k.box(0.015, H - y0, hw * 2 - 0.12, panelM, -hl + 0.06, (y0 + H) / 2, 0);
  k.box(0.025, 0.02, hw * 2 - 0.12, teal, -hl + 0.06, H, 0);
  k.box(0.015, (H - y0) * 0.45, hw * 2 - 0.12, panelM, hl - 0.06, H - (H - y0) * 0.225, 0);
  // Dye rotor with its curved "dolphin tail" fin.
  const rotor = new THREE.Group();
  rotor.position.set(-0.05, 0.16, 0);
  k.g.add(rotor);
  k.cyl(0.32, 0.32, 0.025, std(0xe3c34a, { roughness: 0.5 }), 0, 0, 0, rotor, 40);
  const tail = k.mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 24, Math.PI * 0.9), std(0x2563c9), 0, 0.06, 0, rotor);
  tail.rotation.x = Math.PI / 2;
  const fill = { x0: -hl + 0.08, x1: hl - 0.1, z0: -hw + 0.08, z1: hw - 0.08, y0: 0.19, y1: H - 0.1 };
  // Over-the-bumper tube intake.
  const rollers = [k.rollerZ(0.035, p.intakeW * 2, gray, hl + 0.05, 0.1), k.rollerZ(0.03, p.intakeW * 2, gray, hl + 0.01, 0.2)];
  for (const sz of [-1, 1]) k.box(0.16, 0.025, 0.02, black, hl - 0.03, 0.15, sz * (p.intakeW + 0.02));
  const turrets = p.turrets.map((t) => {
    const tg = turretGroup(k, t, H);
    k.cyl(0.19, 0.19, 0.045, black, 0, 0, 0, tg, 36);
    k.cyl(0.16, 0.16, 0.012, std(0xf08a24, { roughness: 0.45 }), 0, 0.03, 0, tg, 36);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      const leg = k.box(0.015, 0.12, 0.015, black, Math.cos(a) * 0.08, 0.09, Math.sin(a) * 0.08, tg);
      leg.rotation.z = Math.cos(a) * 0.3;
    }
    k.rollerZ(0.045, 0.1, std(0x2c3036, { metalness: 0.4 }), 0.05, 0.1, 0, tg);
    const hood = k.box(0.17, 0.012, 0.12, std(0x2563c9), 0.11, 0.15, 0, tg);
    hood.rotation.z = 0.5;
    return tg;
  });
  return { fill, rollers, rotor, turrets, hook: hook(k, hl - 0.15, H) };
}

const BUILDERS = { generic, overload, kepler, alphadogs, artemis, ripcurrent };

// Held FUEL drawn as real balls packed into the hopper volume, bottom layer first.
// Volume is a box {x0,x1,z0,z1,y0,y1} or an annulus {r0,r1,y0,y1}.
const BALL_GEO = new THREE.SphereGeometry(0.074, 10, 8);
const BALL_MAT = new THREE.MeshStandardMaterial({ color: COLORS.fuel, roughness: 0.55, emissive: 0x2a2000 });
function fuelStack(g, v) {
  const d = 0.15, spots = [];
  for (let layer = 0, y = v.y0 + 0.075; y <= v.y1 - 0.05; layer++, y += d * 0.85) {
    const off = layer % 2 ? d / 2 : 0;
    if (v.r1 !== undefined) {
      for (let rr = v.r0 + 0.075; rr <= v.r1 - 0.074; rr += d) {
        const n = Math.floor((2 * Math.PI * rr) / d);
        for (let i = 0; i < n; i++) {
          const a = ((i + (layer % 2) * 0.5) / n) * Math.PI * 2;
          spots.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
        }
      }
    } else {
      for (let x = v.x0 + 0.075 + off; x <= v.x1 - 0.07; x += d) for (let z = v.z0 + 0.075 + off; z <= v.z1 - 0.07; z += d) spots.push([x, y, z]);
    }
  }
  const mesh = new THREE.InstancedMesh(BALL_GEO, BALL_MAT, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  spots.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x + (Math.random() - 0.5) * 0.02, y, z + (Math.random() - 0.5) * 0.02)));
  mesh.count = 0;
  mesh.frustumCulled = false;
  g.add(mesh);
  return { mesh, spots: spots.length };
}

export function buildRobotModel(robot) {
  const g = new THREE.Group();
  const parts = (BUILDERS[robot.p.model] || generic)(new Kit(g), robot);
  if (robot.isPlayer) {
    const ext = Math.max(robot.p.halfL, robot.p.halfW) * 1.45;
    const ring = new THREE.Mesh(new THREE.RingGeometry(ext, ext + 0.06, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    g.add(ring);
  }
  return { group: g, ...parts, fill: fuelStack(g, parts.fill) };
}
