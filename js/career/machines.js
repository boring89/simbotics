import * as THREE from '../three.js';

// Low-poly models of the shop's machines and furniture. Each builder returns { group, ...moving
// parts }. Local axes: origin on the floor at the middle of the footprint, the operator side faces +z.

export const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1, ...o });
const M = {
  green: std(0x3d6b4f, { roughness: 0.5, metalness: 0.3 }), grey: std(0x8d949c, { metalness: 0.25, roughness: 0.5 }),
  dark: std(0x24272d), steel: std(0xc9cfd6, { metalness: 0.35, roughness: 0.35 }), blue: std(0x2f5fa8, { metalness: 0.3, roughness: 0.45 }),
  orange: std(0xe07a1f, { roughness: 0.5 }), wood: std(0x9b7b55, { roughness: 0.85 }), black: std(0x15171b, { roughness: 0.8 }),
  red: std(0xb3262e, { metalness: 0.3, roughness: 0.45 }), white: std(0xe8eaee, { roughness: 0.7 }), yellow: std(0xf2c230, { roughness: 0.5 }),
};
export { M as MAT };

export function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function cyl(r, h, mat, x, y, z, parent, axis = 'y', seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  parent.add(m);
  return m;
}
function label(text, w = 0.5) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#111'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#f2c230'; x.font = 'bold 30px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t }));
}
export { label as signMesh };

// Vertical band saw. Table top at y = 1.0, blade at x = 0, z = -0.05; feed is toward -z.
export function bandsaw() {
  const g = new THREE.Group();
  box(0.6, 0.9, 0.55, M.blue, 0, 0.45, -0.1, g);
  box(0.18, 1.0, 0.18, M.blue, 0.3, 1.3, -0.25, g);
  box(0.7, 0.5, 0.2, M.blue, 0.05, 1.75, -0.25, g);
  box(0.62, 0.04, 0.62, M.grey, 0, 1.0, 0, g);
  const blade = box(0.006, 0.75, 0.02, M.steel, 0, 1.35, -0.05, g);
  box(0.06, 0.12, 0.06, M.dark, 0, 1.4, -0.05, g);   // blade guide
  const sw = box(0.08, 0.05, 0.03, M.red, 0.24, 0.9, 0.18, g);
  return { group: g, blade, switch: sw, table: 1.02 };
}

// Drill press: table with a vise at y ~ 0.95; the quill comes down at x = 0, z = 0.
export function drillpress() {
  const g = new THREE.Group();
  box(0.42, 0.06, 0.5, M.green, 0, 0.03, -0.05, g);
  cyl(0.04, 1.65, M.steel, 0, 0.85, -0.22, g);
  box(0.24, 0.26, 0.42, M.green, 0, 1.55, -0.1, g);
  box(0.2, 0.12, 0.2, M.green, 0, 1.75, -0.25, g);   // belt cover
  const quill = new THREE.Group();
  quill.position.set(0, 1.42, 0);
  g.add(quill);
  cyl(0.025, 0.12, M.steel, 0, -0.06, 0, quill);
  cyl(0.03, 0.06, M.dark, 0, -0.14, 0, quill);        // chuck
  const bit = cyl(0.004, 0.09, M.steel, 0, -0.21, 0, quill, 'y', 8);
  const wheel = new THREE.Group();
  wheel.position.set(0.14, 1.5, -0.05);
  g.add(wheel);
  for (let i = 0; i < 3; i++) { const s = cyl(0.008, 0.16, M.steel, 0, 0, 0, wheel, 'y', 6); s.rotation.x = (i / 3) * Math.PI * 2; s.position.set(0, Math.cos((i / 3) * Math.PI * 2) * 0.08, Math.sin((i / 3) * Math.PI * 2) * 0.08); }
  box(0.36, 0.03, 0.32, M.grey, 0, 0.9, 0, g);        // table
  const vise = new THREE.Group();
  vise.position.set(0, 0.915, 0);
  g.add(vise);
  box(0.2, 0.04, 0.14, M.dark, 0, 0.02, 0, vise);
  box(0.2, 0.05, 0.02, M.dark, 0, 0.06, -0.06, vise);
  box(0.2, 0.05, 0.02, M.dark, 0, 0.06, 0.06, vise);
  const sw = box(0.05, 0.03, 0.03, M.red, 0.12, 1.6, 0.12, g);
  return { group: g, quill, bit, wheel, vise, switch: sw, top: 0.975, quillY: 1.42 };
}

// Bench lathe on a stand. Spindle axis along x at y = 1.12; chuck face at x = -0.3.
export function lathe() {
  const g = new THREE.Group();
  box(1.3, 0.85, 0.5, M.grey, 0, 0.425, 0, g);
  box(1.2, 0.08, 0.22, M.green, 0, 0.92, -0.05, g);    // bed
  box(0.3, 0.32, 0.3, M.green, -0.5, 1.12, -0.05, g);  // headstock
  const chuck = new THREE.Group();
  chuck.position.set(-0.33, 1.12, 0);
  g.add(chuck);
  cyl(0.075, 0.06, M.steel, 0, 0, 0, chuck, 'x', 24);
  for (let i = 0; i < 3; i++) { const j = box(0.03, 0.03, 0.02, M.dark, 0.035, 0, 0, chuck); j.position.y = Math.cos(i * 2.09) * 0.04; j.position.z = Math.sin(i * 2.09) * 0.04; }
  box(0.16, 0.18, 0.18, M.green, 0.5, 1.05, -0.05, g); // tailstock
  const carriage = new THREE.Group();
  carriage.position.set(0.1, 0.97, 0);
  g.add(carriage);
  box(0.2, 0.06, 0.26, M.green, 0, 0.03, 0, carriage);
  const cross = new THREE.Group();
  cross.position.set(0, 0.06, 0.12);
  carriage.add(cross);
  box(0.1, 0.04, 0.16, M.green, 0, 0.02, -0.04, cross);
  box(0.06, 0.06, 0.06, M.dark, 0, 0.07, -0.06, cross); // tool post
  const tool = box(0.012, 0.012, 0.09, M.yellow, 0, 0.09, -0.12, cross); // tip at z = -0.165 in cross space
  const sw = box(0.06, 0.04, 0.03, M.red, -0.5, 1.0, 0.11, g);
  return { group: g, chuck, carriage, cross, tool, switch: sw, axisY: 1.12, chuckX: -0.3 };
}

// CNC router: bed at y = 0.82 (1.2 × 1.2 m); gantry moves along z, spindle along x and y.
export function cnc() {
  const g = new THREE.Group();
  box(1.4, 0.75, 1.4, M.dark, 0, 0.375, 0, g);
  const bed = box(1.25, 0.06, 1.25, M.wood, 0, 0.79, 0, g);
  for (const x of [-0.68, 0.68]) box(0.06, 0.08, 1.35, M.grey, x, 0.86, 0, g);
  const gantry = new THREE.Group();
  gantry.position.set(0, 0.82, 0);
  g.add(gantry);
  for (const x of [-0.68, 0.68]) box(0.08, 0.5, 0.12, M.grey, x, 0.25, 0, gantry);
  box(1.44, 0.12, 0.12, M.grey, 0, 0.5, 0, gantry);
  const head = new THREE.Group();
  head.position.set(0, 0, 0.09);
  gantry.add(head);
  box(0.14, 0.2, 0.08, M.orange, 0, 0.45, 0, head);
  const spindle = new THREE.Group();
  head.add(spindle);
  spindle.position.y = 0.3;
  cyl(0.04, 0.16, M.white, 0, 0, 0, spindle);
  const bit = cyl(0.004, 0.05, M.steel, 0, -0.1, 0, spindle, 'y', 8);
  return { group: g, gantry, head, spindle, bit, bed, top: 0.82 };
}

// Bed-slinger 3D printer on a small table.
export function printer() {
  const g = new THREE.Group();
  box(0.7, 0.75, 0.6, M.wood, 0, 0.375, 0, g);
  box(0.4, 0.05, 0.42, M.dark, 0, 0.78, 0, g);
  for (const x of [-0.19, 0.19]) box(0.03, 0.45, 0.03, M.dark, x, 1.0, -0.12, g);
  box(0.41, 0.03, 0.03, M.dark, 0, 1.22, -0.12, g);
  const bed = new THREE.Group();
  bed.position.set(0, 0.82, 0);
  g.add(bed);
  box(0.24, 0.01, 0.24, M.black, 0, 0, 0, bed);
  const bar = new THREE.Group();
  bar.position.set(0, 0.95, -0.12);
  g.add(bar);
  box(0.38, 0.02, 0.02, M.grey, 0, 0, 0, bar);
  const head = box(0.05, 0.06, 0.05, M.orange, 0, -0.02, 0.03, bar);
  const screen = box(0.08, 0.05, 0.01, std(0x0a2a4a, { emissive: 0x1a4a8a, emissiveIntensity: 0.6 }), 0.12, 0.8, 0.22, g);
  const print = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.06), std(0x2f9e5b, { roughness: 0.5 }));
  print.scale.y = 0.001;
  print.position.y = 0.005;
  bed.add(print);
  return { group: g, bed, bar, head, screen, print };
}

// Workbench with a vise and a pegboard of hand tools.
export function workbench() {
  const g = new THREE.Group();
  box(1.8, 0.06, 0.75, M.wood, 0, 0.9, 0, g);
  for (const x of [-0.85, 0.85]) for (const z of [-0.32, 0.32]) box(0.06, 0.88, 0.06, M.grey, x, 0.44, z, g);
  box(1.7, 0.03, 0.65, M.wood, 0, 0.25, 0, g);
  box(1.8, 0.9, 0.03, std(0xc9b48a), 0, 1.5, -0.37, g);   // pegboard
  for (let i = 0; i < 7; i++) box(0.03, 0.18 + (i % 3) * 0.05, 0.02, [M.red, M.dark, M.yellow, M.steel][i % 4], -0.7 + i * 0.23, 1.55, -0.34, g);
  const vise = new THREE.Group();
  vise.position.set(0.6, 0.93, 0.25);
  g.add(vise);
  box(0.16, 0.08, 0.12, M.blue, 0, 0.04, 0, vise);
  box(0.16, 0.06, 0.03, M.blue, 0, 0.1, -0.05, vise);
  box(0.16, 0.06, 0.03, M.blue, 0, 0.1, 0.05, vise);
  return { group: g, vise, top: 0.93 };
}

// Computer desk; the screen face is a canvas texture the world can redraw.
export function desk() {
  const g = new THREE.Group();
  box(1.5, 0.05, 0.7, M.wood, 0, 0.75, 0, g);
  for (const x of [-0.7, 0.7]) box(0.05, 0.73, 0.6, M.grey, x, 0.37, 0, g);
  box(0.06, 0.25, 0.06, M.dark, 0, 0.9, -0.2, g);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  box(0.62, 0.38, 0.03, M.black, 0, 1.15, -0.22, g);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(0, 1.15, -0.204);
  g.add(screen);
  box(0.45, 0.02, 0.15, M.dark, 0, 0.785, 0.05, g);   // keyboard
  // Chair.
  box(0.45, 0.06, 0.45, M.black, 0, 0.46, 0.55, g);
  box(0.45, 0.5, 0.05, M.black, 0, 0.75, 0.78, g);
  cyl(0.03, 0.42, M.grey, 0, 0.22, 0.55, g);
  // A row of laptops for the crew.
  for (const x of [-0.5, 0.5]) { box(0.3, 0.015, 0.2, M.dark, x, 0.785, 0.15, g); const l = box(0.3, 0.2, 0.01, M.dark, x, 0.88, 0.05, g); l.rotation.x = -0.25; }
  return { group: g, screenCanvas: c, screenTex: tex };
}

export function whiteboard() {
  const g = new THREE.Group();
  box(2.0, 1.1, 0.03, M.grey, 0, 1.55, 0, g);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 280;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.92, 1.02), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, 1.55, 0.017);
  g.add(face);
  return { group: g, canvas: c, tex };
}

// Shelving with stock material (tubes, plates, shafts) shown by how much we have.
export function rack() {
  const g = new THREE.Group();
  for (const x of [-0.95, 0.95]) for (const z of [-0.25, 0.25]) box(0.05, 1.8, 0.05, M.orange, x, 0.9, z, g);
  for (const y of [0.3, 0.8, 1.3, 1.75]) box(1.95, 0.04, 0.55, M.grey, 0, y, 0, g);
  const stock = new THREE.Group();
  g.add(stock);
  return { group: g, stock };
}

export function shelf() {
  const g = new THREE.Group();
  for (const x of [-0.6, 0.6]) box(0.04, 1.5, 0.45, M.grey, x, 0.75, 0, g);
  for (const y of [0.15, 0.6, 1.05, 1.48]) box(1.24, 0.03, 0.45, M.grey, 0, y, 0, g);
  const bins = [];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) {
    const b = box(0.26, 0.16, 0.36, [M.blue, M.red, M.yellow, M.green][(r + i) % 4], -0.43 + i * 0.29, 0.25 + r * 0.45, 0, g);
    bins.push(b);
  }
  const fill = new THREE.Group();
  g.add(fill);
  return { group: g, bins, fill };
}

export function cart() {
  const g = new THREE.Group();
  box(1.1, 0.06, 1.0, M.dark, 0, 0.5, 0, g);
  for (const x of [-0.5, 0.5]) for (const z of [-0.45, 0.45]) {
    box(0.04, 0.46, 0.04, M.grey, x, 0.27, z, g);
    cyl(0.05, 0.04, M.black, x, 0.05, z, g, 'z', 14);
  }
  const top = new THREE.Group();
  top.position.y = 0.53;
  g.add(top);
  return { group: g, top };
}

export function box3d(color = 0xb08a5a, w = 0.5, h = 0.35, d = 0.4) {
  const g = new THREE.Group();
  box(w, h, d, std(color, { roughness: 0.95 }), 0, h / 2, 0, g);
  box(w + 0.005, 0.04, 0.06, std(0xd8c9a0), 0, h - 0.015, 0, g);   // tape
  return g;
}

// A student: body, head and arms. Returns handles to animate walking and working.
export function person(shirt) {
  const g = new THREE.Group();
  const legs = [-0.09, 0.09].map((x) => { const l = box(0.11, 0.8, 0.13, std(0x2b3140), x, 0.4, 0, g); l.geometry.translate(0, -0.4, 0); l.position.y = 0.8; return l; });
  box(0.36, 0.55, 0.2, std(shirt), 0, 1.08, 0, g);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), std(0xe0b48c));
  head.position.y = 1.5;
  head.castShadow = true;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, 1.4), std(0x2a2018));
  hair.position.y = 1.52;
  g.add(hair);
  const arms = [-0.23, 0.23].map((x) => { const a = box(0.09, 0.55, 0.1, std(shirt), x, 1.08, 0, g); a.geometry.translate(0, -0.25, 0); a.position.y = 1.32; return a; });
  return { group: g, legs, arms, head };
}
