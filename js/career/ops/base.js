import * as THREE from '../../three.js';

// Shared plumbing for hands-on operations. An operation owns the camera while it runs, draws its
// own HUD panel and reports back with done(quality) or cancel().
//
// ctx: { g, part, i, n, machine, camera, scene, hud, done(q, info), cancel(), toast(text), breakTool() }

export const IN = 0.0254;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const fmtIn = (v, d = 3) => `${v.toFixed(d)} in`;

export class Op {
  constructor(ctx) {
    this.ctx = ctx;
    this.p = ctx.part;
    this.m = ctx.machine;        // machine handle (from machines.js) or null
    this.objs = [];
    this.keys = new Set();
    this.step = 0;
    this.time = 0;
    this.zoom = 1;
  }
  get g() { return this.ctx.g; }

  // Add a mesh in machine-local space (removed on exit).
  add(obj, parent = this.m.group) { parent.add(obj); this.objs.push([obj, parent]); return obj; }
  mesh(geo, mat, x, y, z, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return this.add(m, parent); }

  // Camera at a machine-local position looking at a machine-local point.
  cam(pos, look) {
    const g = this.m.group;
    g.updateMatrixWorld();
    const p = g.localToWorld(new THREE.Vector3(...pos)), l = g.localToWorld(new THREE.Vector3(...look));
    const c = this.ctx.camera;
    c.position.copy(p);
    c.up.set(0, 1, 0);
    c.lookAt(l);
  }

  // HUD: title, drawing info, the list of steps, live readouts and hints.
  panel({ title, info = '', steps = [], read = '', hint = '' }) {
    if (!this.ui) { this.ui = document.createElement('div'); this.ctx.hud.appendChild(this.ui); }
    const h = this.ui;
    h.innerHTML = `<div class="op-panel"><h3>${title}</h3>${info ? `<div class="op-info">${info}</div>` : ''}
      <ol class="op-steps">${steps.map((s, i) => `<li class="${i < this.step ? 'done' : i === this.step ? 'on' : ''}">${s}</li>`).join('')}</ol>
      <div class="op-read">${read}</div><div class="op-keys">${hint}<br><span>Esc 放棄</span></div></div><div class="op-msg"></div>`;
    this.readEl = h.querySelector('.op-read');
    this.msgEl = h.querySelector('.op-msg');
  }
  read(html) { if (this.readEl && this.readEl.innerHTML !== html) this.readEl.innerHTML = html; }
  msg(text, kind = '') {
    if (!this.msgEl) return;
    this.msgEl.textContent = text;
    this.msgEl.className = `op-msg show ${kind}`;
    clearTimeout(this.msgT);
    this.msgT = setTimeout(() => { if (this.msgEl) this.msgEl.className = 'op-msg'; }, 2200);
  }

  key(code, down) { if (down) this.keys.add(code); else this.keys.delete(code); }
  held(c) { return this.keys.has(c); }
  mouse() {}
  wheel(dy) { this.zoom = clamp(this.zoom * (dy > 0 ? 1.12 : 0.89), 0.35, 2.5); }
  update(dt) { this.time += dt; }
  exit() {
    for (const [o, parent] of this.objs) { parent.remove(o); o.traverse?.((x) => { x.geometry?.dispose(); }); }
    this.objs = [];
    this.ctx.hud.innerHTML = '';
    this.ui = null;
  }
  finish(q, info) { this.over = true; this.ctx.done(clamp(q, 0, 1), info); }
}

// A full-screen 2D canvas for operations drawn flat (bench work, CNC setup, printer).
export function overlayCanvas(hud) {
  const c = document.createElement('canvas');
  c.className = 'op-canvas';
  hud.prepend(c);
  const fit = () => { c.width = c.clientWidth * devicePixelRatio; c.height = c.clientHeight * devicePixelRatio; };
  fit();
  return { c, x: c.getContext('2d'), fit };
}

export const mats = {
  alu: new THREE.MeshStandardMaterial({ color: 0xd3d8de, metalness: 0.3, roughness: 0.4 }),
  poly: new THREE.MeshStandardMaterial({ color: 0xdfefff, transparent: true, opacity: 0.55, roughness: 0.1 }),
  mark: new THREE.MeshBasicMaterial({ color: 0x111111 }),
  laser: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
  hole: new THREE.MeshBasicMaterial({ color: 0x050505 }),
  ok: new THREE.MeshBasicMaterial({ color: 0x22c55e }),
  bad: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
  bolt: new THREE.MeshStandardMaterial({ color: 0xf59f00, emissive: 0x7a4a00, emissiveIntensity: 0.6 }),
};
export const stockMat = (p) => (p.kind === 'poly' ? mats.poly : mats.alu);
// Cross-section of a part's stock in inches: [width, thickness].
export function section(p) {
  if (p.kind === 'tube') return p.mat === 'tube1x1' ? [1, 1] : [2, 1];
  if (p.kind === 'hex') return [0.5, 0.5];
  if (p.kind === 'plate') return [0, p.mat === 'plate14' ? 0.25 : 0.125];
  return [0, 0.125];
}
