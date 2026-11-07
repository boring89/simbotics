import * as THREE from './three.js';
import { buildRobotModel } from './models.js';
import { compile, PAINT } from './parts.js';

// The team's 10 × 10 ft pit at an event: carpet, pipe-and-drape walls with the team banner,
// workbench, toolbox, battery cart and the robot on its cart, with neighbours down the aisle.

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...o });
const box = (w, h, d, mat, x, y, z, parent) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};

function bannerTexture(number, name, color) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 1024, 256);
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 200, 1024, 56);
  x.fillStyle = '#fff'; x.textAlign = 'center';
  x.font = 'bold 130px system-ui, sans-serif'; x.fillText(String(number), 512, 150);
  x.font = '38px system-ui, sans-serif'; x.fillText((name || '').slice(0, 40), 512, 240);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FT = 0.3048, SIZE = 10 * FT;

// One booth at x (along the aisle); face = +1 opens toward +z.
function booth(parent, x, face, number, name, color, full) {
  const g = new THREE.Group();
  g.position.set(x, 0, 0);
  g.rotation.y = face > 0 ? 0 : Math.PI;
  parent.add(g);
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), std(full ? 0x30343c : 0x2a2d33, { roughness: 1 }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.004, 0);
  g.add(carpet);
  const drape = std(0x1c2236, { roughness: 1 });
  box(SIZE, 2.4, 0.04, drape, 0, 1.2, -SIZE / 2, g);
  for (const s of [-1, 1]) box(0.04, 0.95, SIZE, drape, s * SIZE / 2, 0.475, 0, g);
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: bannerTexture(number, name, hex) }));
  banner.position.set(0, 2.0, -SIZE / 2 + 0.03);
  g.add(banner);
  // Workbench and toolbox along the back wall.
  const wood = std(0x8a6a45), steel = std(0x6d737c, { metalness: 0.5, roughness: 0.4 });
  box(1.7, 0.05, 0.65, wood, -0.55, 0.9, -SIZE / 2 + 0.4, g);
  for (const lx of [-1.35, 0.25]) for (const lz of [-SIZE / 2 + 0.12, -SIZE / 2 + 0.68]) box(0.05, 0.9, 0.05, steel, lx, 0.45, lz, g);
  const red = std(0xb3262e, { metalness: 0.3, roughness: 0.4 });
  box(0.7, 0.95, 0.45, red, 1.05, 0.5, -SIZE / 2 + 0.3, g);
  for (let i = 0; i < 5; i++) box(0.62, 0.012, 0.01, steel, 1.05, 0.25 + i * 0.15, -SIZE / 2 + 0.53, g);
  if (!full) return g;
  // Laptop, tools and a battery cart with chargers.
  box(0.35, 0.02, 0.25, std(0x22252b), -0.9, 0.935, -SIZE / 2 + 0.4, g);
  const lid = box(0.35, 0.24, 0.015, std(0x22252b, { emissive: 0x2244aa, emissiveIntensity: 0.35 }), -0.9, 1.05, -SIZE / 2 + 0.29, g);
  lid.rotation.x = -0.2;
  box(0.28, 0.06, 0.12, std(0xf0a020), -0.3, 0.955, -SIZE / 2 + 0.45, g);
  box(0.55, 0.7, 0.4, steel, -1.15, 0.35, SIZE / 2 - 0.5, g);
  for (let i = 0; i < 3; i++) {
    box(0.16, 0.17, 0.18, std(0x15161a), -1.33 + i * 0.18, 0.79, SIZE / 2 - 0.5, g);
    box(0.03, 0.02, 0.03, std(0x22c55e, { emissive: 0x22c55e, emissiveIntensity: 1 }), -1.33 + i * 0.18, 0.885, SIZE / 2 - 0.42, g);
  }
  return g;
}

export class PitView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0c0e12);
    s.fog = new THREE.Fog(0x0c0e12, 8, 22);
    s.add(new THREE.HemisphereLight(0xe8eeff, 0x2a2c30, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 6, 4);
    s.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), std(0x4a4d52, { roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 60);
    this.world = null;
    this.robot = null;
  }

  // neighbours: team numbers for the booths around ours.
  show(build, number, name, neighbours = []) {
    if (this.world) this.scene.remove(this.world);
    const w = this.world = new THREE.Group();
    this.scene.add(w);
    const color = PAINT[build.color] ?? PAINT.silver;
    const mine = booth(w, 0, 1, number, name, color === PAINT.silver ? 0x2f6fe4 : color, true);
    const palette = Object.values(PAINT);
    const nb = [...neighbours];
    for (let i = -3; i <= 3; i++) {
      if (i !== 0) booth(w, i * (SIZE + 0.05), 1, nb.shift() ?? 1000 + i, '', palette[(i + 7) % palette.length], false);
      booth(w, i * (SIZE + 0.05), -1, nb.shift() ?? 2000 + i, '', palette[(i + 11) % palette.length], false).position.z = SIZE * 2 + 1.8;
    }
    // Robot cart in the middle of our pit.
    const cart = new THREE.Group();
    cart.position.set(0.25, 0, 0.15);
    mine.add(cart);
    const alu = std(0x9aa0a8, { metalness: 0.6, roughness: 0.35 });
    box(1.0, 0.06, 0.95, std(0x3a3f46), 0, 0.5, 0, cart);
    for (const x of [-0.45, 0.45]) for (const z of [-0.42, 0.42]) {
      box(0.04, 0.46, 0.04, alu, x, 0.27, z, cart);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), std(0x111111));
      wheel.rotation.x = Math.PI / 2; wheel.position.set(x, 0.05, z);
      cart.add(wheel);
    }
    const m = buildRobotModel({ p: compile(build), alliance: 'blue', number, isPlayer: false });
    m.fill.mesh.count = 0;
    m.group.position.y = 0.53;
    m.group.rotation.y = -0.6;
    cart.add(m.group);
    this.robot = m.group;
  }

  start() {
    if (this.looping) return;
    this.looping = true;
    const tick = (t) => {
      if (!this.looping || !this.canvas.isConnected) { this.looping = false; return; }
      requestAnimationFrame(tick);
      const c = this.canvas, w = c.clientWidth, h = c.clientHeight, pr = this.renderer.getPixelRatio();
      if (!w || !h) return;
      if (c.width !== Math.round(w * pr) || c.height !== Math.round(h * pr)) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      const a = Math.sin(t / 5000) * 0.35;
      this.camera.position.set(Math.sin(a) * 3.0, 1.9, 2.9 + Math.cos(a) * 0.4);
      this.camera.lookAt(0.15, 0.7, -0.25);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(tick);
  }

  stop() { this.looping = false; }
}
