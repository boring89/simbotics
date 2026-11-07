import * as THREE from '../three.js';
import { SHOPS, SHIRTS, SUBS, SUB_ORDER, fmtDate, fmtClock, dayOf, VENDORS } from './data.js';
import { eventByKey, shortName } from '../season.js';
import { stationOf, partDone, drivable } from './state.js';
import * as K from './machines.js';
import { buildWip, showWip } from './robotwip.js';

// The 3D workshop: room, furniture, machines in their floor slots, deliveries at the door, the
// robot on its cart and the crew walking between stations. Also the first-person walker.

const ORDER = ['band', 'drill', 'lathe', 'cnc', 'printer'];
const EYE = 1.62, R = 0.28;

// Anywhere you walk around in first person: collision boxes, things to interact with, the robot
// on its cart and the crew. The shop, the test site and the event venue build on this.
export class Place {
  constructor(scene, g) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.g = g;
    this.solid = [];        // { x0, x1, z0, z1 }
    this.inter = [];        // { obj, kind, key, label }
    this.crewViz = new Map();
    this.bounds = { x0: -10, x1: 10, z0: -10, z1: 10 };
    this.player = { x: 0, z: 0, yaw: 0, pitch: 0 };
  }

  add(model, x, z, rot, kind, key, label, foot) {
    model.position.set(x, 0, z);
    model.rotation.y = rot;
    this.root.add(model);
    if (foot) {
      const [w, d] = Math.abs(Math.sin(rot)) > 0.5 ? [foot[1], foot[0]] : foot;
      this.solid.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
    }
    if (kind) this.inter.push({ obj: model, kind, key, label });
    return model;
  }

  makeWip() {
    if (this.wip) this.cartM.top.remove(this.wip.group);
    this.wip = this.g.design ? buildWip(this.g.design, this.g.team.number) : null;
    if (this.wip) { this.wip.group.rotation.y = -0.5; this.cartM.top.add(this.wip.group); }
  }
  // ghost: a subsystem to show see-through while it's being assembled (kept until cleared with null).
  showRobot(ghost = this.ghost) {
    this.ghost = ghost;
    if (!this.wip) return;
    const st = {};
    for (const s of SUB_ORDER) st[s] = this.g.subs[s]?.done ? 'done' : s === ghost ? 'ghost' : 'hidden';
    showWip(this.wip, st);
  }

  updateCrew(dt, here) {
    const g = this.g, count = {};
    const list = this.crewList();
    for (const v of this.crewViz.values()) v.group.visible = false;
    for (const c of list) {
      let v = this.crewViz.get(c.id);
      if (!v) {
        v = K.person(SHIRTS[g.crew.indexOf(c) % SHIRTS.length]);
        v.group.position.set(this.entry.x, 0, this.entry.z + (g.crew.indexOf(c) % 3 - 1) * 0.5);
        v.path = []; v.phase = Math.random() * 6;
        this.root.add(v.group);
        this.crewViz.set(c.id, v);
        this.inter.push({ obj: v.group, kind: 'crew', key: c.id, label: `和${c.name}說話` });
      }
      v.group.visible = here;
      if (!here) { v.group.position.set(this.entry.x, 0, this.entry.z); v.path = []; v.target = null; continue; }
      const st = this.stationFor(c);
      const idx = count[st] = (count[st] ?? -1) + 1;
      const tgt = this.standPoint(st, idx);
      const tk = `${tgt.x.toFixed(2)},${tgt.z.toFixed(2)}`;
      if (v.target !== tk) {
        v.target = tk; v.face = tgt.face; v.gone = tgt.gone;
        const p = v.group.position;
        v.path = this.route(p, tgt);
      }
      const p = v.group.position;
      let moving = false;
      while (v.path.length) {
        const w = v.path[0], dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.05) { v.path.shift(); continue; }
        const s = Math.min(d, 1.4 * dt);
        p.x += (dx / d) * s; p.z += (dz / d) * s;
        v.group.rotation.y = Math.atan2(dx, dz);
        moving = true;
        break;
      }
      v.phase += dt * (moving ? 9 : 4);
      const sw = moving ? Math.sin(v.phase) * 0.5 : 0;
      v.legs[0].rotation.x = sw; v.legs[1].rotation.x = -sw;
      if (!moving) {
        v.group.rotation.y = v.face ?? 0;
        const work = st !== 'idle';
        v.arms[0].rotation.x = work ? -0.9 + Math.sin(v.phase) * 0.25 : 0;
        v.arms[1].rotation.x = work ? -0.9 - Math.sin(v.phase * 1.3) * 0.25 : 0;
        if (v.gone) v.group.visible = false;
      } else { v.arms[0].rotation.x = -sw * 0.8; v.arms[1].rotation.x = sw * 0.8; }
    }
  }

  // ---------- First person ----------
  // Who is here: the whole team at the shop, only the travellers at an event.
  crewList() {
    const g = this.g;
    if (g.where === 'shop') return g.crew;
    const trip = Object.values(g.trips || {}).find((t) => t.stage === 'travel' || t.stage === 'arrived');
    const people = trip?.people || g.crew.map((c) => c.id);
    return g.crew.filter((c) => people.includes(c.id));
  }

  collide(x, z) {
    for (const b of this.solid) {
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d < R) {
        if (d > 1e-6) { x = cx + (dx / d) * R; z = cz + (dz / d) * R; } else { x += R; }
      }
    }
    return [x, z];
  }
  walk(dt, f, s, run) {
    const p = this.player, sp = (run ? 3.6 : 2.2) * dt;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let x = p.x + (fx * f + -fz * -s) * sp, z = p.z + (fz * f + fx * -s) * sp;
    if (f && s) { x = p.x + (fx * f + -fz * -s) * sp / Math.SQRT2; z = p.z + (fz * f + fx * -s) * sp / Math.SQRT2; }
    [x, z] = this.collide(x, z);
    const b = this.bounds;
    p.x = Math.max(b.x0 + R, Math.min(b.x1 - R, x));
    p.z = Math.max(b.z0 + R, Math.min(b.z1 - R, z));
  }
  look(dx, dy) {
    const p = this.player;
    p.yaw -= dx * 0.0022;
    p.pitch = Math.max(-1.45, Math.min(1.35, p.pitch - dy * 0.0022));
  }
  applyCamera(cam) {
    const p = this.player;
    cam.position.set(p.x, EYE, p.z);
    cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  }

  // What the crosshair is on (within reach).
  target(cam) {
    const ray = new THREE.Raycaster(cam.position, cam.getWorldDirection(new THREE.Vector3()), 0, 2.6);
    let best = null;
    for (const it of this.inter) {
      if (!it.obj.visible) continue;
      const hit = ray.intersectObject(it.obj, true)[0];
      if (hit && (!best || hit.distance < best.d)) best = { ...it, d: hit.distance };
    }
    return best;
  }
}

export class Shop extends Place {
  constructor(scene, g) {
    super(scene, g);
    const S = SHOPS[g.shop];
    this.W = S.size[0]; this.D = S.size[1];
    this.bounds = { x0: -this.W / 2, x1: this.W / 2, z0: -this.D / 2, z1: this.D / 2 };
    this.slots = [];        // { x, z, rot }
    this.placed = {};       // machine key -> [{ model, slot }]
    this.room();
    this.furniture(S.slots);
    this.player = { x: -this.W / 2 + 1.3, z: 0.6, yaw: -Math.PI / 2, pitch: -0.05 };
    this.sig = {};
    this.sync(true);
  }

  // ---------- Room ----------
  room() {
    const { W, D } = this, r = this.root;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), K.std(0x8a8d90, { roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    r.add(floor);
    // Safety lines along the aisle.
    for (const z of [-1.05, 1.05]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, 0.06), K.std(0xf2c230));
      l.rotation.x = -Math.PI / 2; l.position.set(0, 0.003, z);
      r.add(l);
    }
    const wall = K.std(0xd9d6cf, { roughness: 0.95 }), H = 3.2;
    const wallBox = (w, d, x, z) => { K.box(w, H, d, wall, x, H / 2, z, r); this.solid.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }); };
    wallBox(W + 0.4, 0.2, 0, -D / 2 - 0.1);
    wallBox(W + 0.4, 0.2, 0, D / 2 + 0.1);
    // End walls with door openings at z = 0.
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + 0.1), seg = (D - 1.6) / 2;
      wallBox(0.2, seg, x, -D / 2 + seg / 2);
      wallBox(0.2, seg, x, D / 2 - seg / 2);
      K.box(0.2, H - 2.3, 1.6, wall, x, 2.3 + (H - 2.3) / 2, 0, r);
      const door = K.box(0.06, 2.25, 1.55, K.std(s < 0 ? 0x6b7a8f : 0x2f9e5b), x - s * 0.02, 1.125, 0, r);
      this.solid.push({ x0: x - 0.1, x1: x + 0.1, z0: -0.8, z1: 0.8 });
      const sign = K.signMesh(s < 0 ? '出入口' : '練習場 →', 0.9);
      sign.position.set(x - s * 0.12, 2.55, 0);
      sign.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      r.add(sign);
      if (s > 0) this.inter.push({ obj: door, kind: 'field', label: '去練習場' });
      else this.inter.push({ obj: door, kind: 'exit', label: '收工回家（跳到下次開門）' });
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), K.std(0xbfc2c6, { roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H;
    r.add(ceil);
    // Fluorescent fixtures.
    const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8ec, emissiveIntensity: 1.4 });
    for (let x = -W / 2 + 2; x < W / 2 - 1; x += 3.2) for (const z of [-D / 4, D / 4]) K.box(1.2, 0.05, 0.18, glow, x, H - 0.05, z, r);
    this.scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x5a5550, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(W * 0.2, 6, D * 0.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -W / 2 - 1, right: W / 2 + 1, top: D / 2 + 1, bottom: -D / 2 - 1, near: 0.5, far: 20 });
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    for (let x = -W / 2 + 3; x < W / 2 - 1; x += 5) { const p = new THREE.PointLight(0xfff4e6, 9, 10, 1.6); p.position.set(x, 2.8, 0); this.scene.add(p); }
  }

  furniture(nSlots) {
    const { W, D } = this;
    const fz = D / 2 - 0.45;   // against the front wall
    const dx = -W / 2 + 1.4;
    this.desk = K.desk();
    this.add(this.desk.group, dx, fz, Math.PI, 'computer', null, '使用電腦', [1.5, 0.7]);
    this.board = K.whiteboard();
    this.add(this.board.group, dx + 2.1, D / 2 - 0.02, Math.PI, 'board', null, '看白板（工作看板與行事曆）');
    this.bench = K.workbench();
    this.add(this.bench.group, dx + 4.4, fz - 0.05, Math.PI, 'bench', null, '使用工作台（去毛邊、攻牙）', [1.8, 0.75]);
    this.shelfM = K.shelf();
    this.add(this.shelfM.group, dx + 6.3, D / 2 - 0.25, Math.PI, 'shelf', null, '零件架', [1.3, 0.5]);
    this.cartM = K.cart();
    this.cartPos = { x: Math.min(dx + 8.2, W / 2 - 1.4), z: D / 2 - 1.7 };
    this.add(this.cartM.group, this.cartPos.x, this.cartPos.z, 0, 'cart', null, '機器人推車（組裝）', [1.1, 1.0]);
    this.rackM = K.rack();
    this.add(this.rackM.group, -W / 2 + 1.35, -D / 2 + 0.35, 0, 'rack', null, '材料架', [2.0, 0.6]);
    // Machine slots: along the back wall, then the rest of the front wall.
    for (let x = -W / 2 + 3.4; x <= W / 2 - 1.1 && this.slots.length < nSlots; x += 1.9) this.slots.push({ x, z: -D / 2 + 0.95, rot: 0 });
    for (let x = this.cartPos.x + 2.1; x <= W / 2 - 1.1 && this.slots.length < nSlots; x += 1.9) this.slots.push({ x, z: D / 2 - 0.95, rot: Math.PI });
    for (const s of this.slots) {
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.5), K.std(0x6f7377, { roughness: 1 }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(s.x, 0.002, s.z);
      this.root.add(pad);
    }
    // Packing area by the door: the shipping crate.
    const crate = new THREE.Group();
    K.box(1.3, 0.9, 1.0, K.std(0xb08a5a, { roughness: 0.95 }), 0, 0.45, 0, crate);
    this.crateM = K.box(1.32, 0.05, 1.02, K.std(0x8a6a45), 0, 0.92, 0, crate);
    const cs = K.signMesh('打包區', 0.6); cs.position.set(0, 1.25, 0.52); crate.add(cs);
    this.add(crate, -W / 2 + 1.2, D / 2 - 2.2, 0, 'crate', null, '打包區（裝箱、寄機器人）', [1.3, 1.0]);
    this.boxGroup = new THREE.Group();
    this.root.add(this.boxGroup);
    this.dropZone = { x: -W / 2 + 1.2, z: -1.9 };
  }

  // ---------- Keep the scene in step with the save ----------
  sync(force = false) {
    const g = this.g;
    const msig = JSON.stringify(g.machines);
    if (force || msig !== this.sig.m) { this.sig.m = msig; this.placeMachines(); }
    const bsig = g.boxes.map((b) => b.id).join();
    if (force || bsig !== this.sig.b) { this.sig.b = bsig; this.placeBoxes(); }
    const rsig = JSON.stringify(g.materials);
    if (force || rsig !== this.sig.r) { this.sig.r = rsig; this.fillRack(); }
    const wsig = `${g.rev}`;
    if (force || wsig !== this.sig.w) { this.sig.w = wsig; this.makeWip(); }
    this.showRobot();
    this.cartM.top.visible = !g.robotAway;
    this.crateM.visible = g.robotAway === 'packed';
    this.fillShelf();
  }

  placeMachines() {
    for (const list of Object.values(this.placed)) for (const p of list) { this.root.remove(p.model.group); this.inter = this.inter.filter((i) => i.obj !== p.model.group); this.solid = this.solid.filter((s) => s !== p.box); }
    this.placed = {};
    let i = 0;
    const make = { band: K.bandsaw, drill: K.drillpress, lathe: K.lathe, cnc: K.cnc, printer: K.printer };
    const foot = { band: [0.8, 0.8], drill: [0.5, 0.6], lathe: [1.35, 0.55], cnc: [1.45, 1.45], printer: [0.7, 0.6] };
    const names = { band: '帶鋸機', drill: '台鑽', lathe: '車床', cnc: 'CNC 路由機', printer: '3D 印表機' };
    for (const k of ORDER) for (let n = 0; n < this.g.machines[k]; n++) {
      const s = this.slots[i++];
      if (!s) break;
      const model = make[k]();
      model.kind = k;
      model.index = n;
      this.add(model.group, s.x, s.z, s.rot, 'machine', `${k}:${n}`, `使用${names[k]}${this.g.machines[k] > 1 ? ` #${n + 1}` : ''}`);
      const [w, d] = foot[k];
      const box = { x0: s.x - w / 2, x1: s.x + w / 2, z0: s.z - d / 2, z1: s.z + d / 2 };
      this.solid.push(box);
      (this.placed[k] ??= []).push({ model, slot: s, box });
    }
  }
  machine(k, n = 0) { return this.placed[k]?.[n]; }

  placeBoxes() {
    this.boxGroup.clear();
    this.inter = this.inter.filter((i) => i.kind !== 'box');
    this.g.boxes.forEach((b, i) => {
      const m = K.box3d(0xb08a5a, 0.55, 0.38 + (i % 2) * 0.1, 0.45);
      const label = K.signMesh(VENDORS[b.vendor].name.slice(0, 12), 0.5);
      label.position.set(0, 0.52 + (i % 2) * 0.1, 0.23);
      m.add(label);
      m.position.set(this.dropZone.x + (i % 3) * 0.7, 0, this.dropZone.z + Math.floor(i / 3) * 0.6);
      this.boxGroup.add(m);
      this.inter.push({ obj: m, kind: 'box', key: b.id, label: `拆開 ${VENDORS[b.vendor].name} 的包裹` });
    });
  }

  fillRack() {
    const st = this.rackM.stock;
    st.clear();
    const m = this.g.materials, alu = K.MAT.steel;
    const n = (k) => Math.min(6, Math.ceil(m[k] - 1e-6));
    for (let i = 0; i < n('tube2x1'); i++) K.box(1.5, 0.05, 0.025, alu, 0, 0.35 + Math.floor(i / 3) * 0.06, -0.15 + (i % 3) * 0.05, st);
    for (let i = 0; i < n('tube1x1'); i++) K.box(1.5, 0.025, 0.025, alu, 0, 0.35, 0.05 + i * 0.035, st);
    for (let i = 0; i < n('plate18'); i++) K.box(0.6, 0.004, 0.45, alu, -0.55, 0.83 + i * 0.006, 0, st);
    for (let i = 0; i < n('plate14'); i++) K.box(0.3, 0.007, 0.45, alu, 0.1, 0.83 + i * 0.008, 0, st);
    for (let i = 0; i < n('poly'); i++) K.box(0.6, 0.004, 0.45, K.std(0xcfe6ff, { transparent: true, opacity: 0.5 }), 0.6, 0.83 + i * 0.006, 0, st);
    for (let i = 0; i < n('hex'); i++) K.cyl(0.007, 0.9, K.MAT.steel, -0.3, 1.34, -0.15 + i * 0.025, st, 'x', 6);
    for (let i = 0; i < n('round'); i++) K.cyl(0.014, 0.3, alu, 0.4, 1.35, -0.15 + i * 0.04, st, 'x', 12);
    for (let i = 0; i < n('filament'); i++) K.cyl(0.1, 0.07, K.std([0x2f9e5b, 0xe0a019, 0x2f6fe4][i % 3]), -0.6 + i * 0.25, 1.83, 0, st, 'z', 16);
  }

  fillShelf() {
    const parts = Object.values(this.g.parts), done = parts.filter(partDone).length;
    const n = parts.length ? Math.round((done / parts.length) * this.shelfM.bins.length) : 0;
    if (n === this.sig.shelf) return;
    this.sig.shelf = n;
    this.shelfM.bins.forEach((b, i) => { b.scale.y = i < n ? 1.25 : 0.6; });
  }

  // Monitor and whiteboard faces.
  drawScreens() {
    const g = this.g, c = this.desk.screenCanvas, x = c.getContext('2d');
    x.fillStyle = '#123a6b'; x.fillRect(0, 0, 256, 160);
    x.fillStyle = '#fff'; x.font = 'bold 26px system-ui'; x.textAlign = 'center';
    x.fillText(fmtClock(g.t), 128, 70);
    x.font = '16px system-ui'; x.fillText(fmtDate(g.t), 128, 96);
    const unread = g.mail.filter((m) => !m.read).length;
    if (unread) { x.fillStyle = '#ff6b6b'; x.fillText(`${unread} 封新信件`, 128, 130); }
    this.desk.screenTex.needsUpdate = true;
    const b = this.board.canvas, y = b.getContext('2d');
    y.fillStyle = '#f7f7f4'; y.fillRect(0, 0, 512, 280);
    y.fillStyle = '#1b4fbf'; y.font = 'bold 30px system-ui'; y.textAlign = 'left';
    const en = g.schedule.find((x) => x.status === 'pending'), e = en && eventByKey(en.key);
    y.fillText(e ? `${shortName(e.name).slice(0, 18)}：${Math.max(0, Math.floor((new Date(`${e.start}T12:00:00`) - new Date('2026-01-10T00:00:00')) / 864e5) - 2 - dayOf(g.t))} 天後出發` : '沒有排定的比賽', 20, 42);
    y.font = '18px system-ui';
    SUB_ORDER.forEach((s, i) => {
      const S = g.subs[s];
      y.fillStyle = !S ? '#999' : S.done ? '#1f8a3a' : '#333';
      y.fillText(`${S?.done ? '☑' : '☐'} ${SUBS[s].name}`, 20 + (i % 2) * 230, 84 + Math.floor(i / 2) * 32);
    });
    y.fillStyle = drivable(g) ? '#1f8a3a' : '#c0392b';
    y.fillText(drivable(g) ? '機器人可以開了！' : '目標：先讓機器人能開', 20, 230);
    this.board.tex.needsUpdate = true;
  }

  // ---------- Crew ----------
  standPoint(st, idx) {
    const { W, D } = this;
    if (st === 'laptop') return { x: this.desk.group.position.x - 0.5 + (idx % 3) * 0.5, z: D / 2 - 1.15, face: Math.PI };
    if (st === 'cart') return { x: this.cartPos.x + (idx % 2 ? 0.8 : -0.8), z: this.cartPos.z, face: idx % 2 ? Math.PI / 2 : -Math.PI / 2 };
    if (st === 'bench') return { x: this.bench.group.position.x - 0.4 + (idx % 2) * 0.8, z: D / 2 - 1.2, face: Math.PI };
    if (st === 'field') return { x: W / 2 - 0.4, z: 0, face: -Math.PI / 2, gone: true };
    const m = this.placed[st]?.[idx % Math.max(1, this.placed[st]?.length || 1)];
    if (m) { const s = m.slot, f = s.rot ? -1 : 1; return { x: s.x, z: s.z + f * 0.95, face: s.rot ? 0 : Math.PI }; }
    return { x: this.board.group.position.x + (idx % 4) * 0.6 - 0.9, z: D / 2 - 1.4 - Math.floor(idx / 4) * 0.6, face: Math.PI };
  }

  get entry() { return { x: -this.W / 2 + 0.5, z: 0 }; }
  stationFor(c) { return c.task ? stationOf(this.g, c.task) : 'idle'; }
  // Walk along the aisle (z = 0) between stations.
  route(p, t) { return [{ x: p.x, z: 0 }, { x: t.x, z: 0 }, { x: t.x, z: t.z }]; }

  // ---------- Machines running by themselves ----------
  animate(t, g) {
    for (const r of g.runs) {
      const list = this.placed[r.st];
      if (!list) continue;
      const k = g.runs.filter((x) => x.st === r.st).indexOf(r), m = list[k % list.length].model;
      const u = 1 - r.left / r.total;
      if (r.st === 'cnc') {
        m.gantry.position.z = Math.sin(t * 0.0021) * 0.45;
        m.head.position.x = Math.sin(t * 0.0033) * 0.5;
        m.spindle.position.y = 0.22;
      } else {
        m.bar.position.x = Math.sin(t * 0.009) * 0.12;
        m.bed.position.z = Math.sin(t * 0.0061) * 0.08;
        m.print.scale.y = Math.max(0.001, u * 0.12);
        m.print.position.y = u * 0.06;
      }
    }
    for (const k of ['cnc', 'printer']) for (const [i, p] of (this.placed[k] || []).entries()) {
      if (g.runs.filter((x) => x.st === k).length > i) continue;
      if (k === 'printer') p.model.print.scale.y = 0.001;
    }
  }

}
