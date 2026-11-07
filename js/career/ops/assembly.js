import * as THREE from '../../three.js';
import { Op, clamp, overlayCanvas, mats } from './base.js';
import { SUBS } from '../data.js';

// Assembly at the robot cart. Mechanical subsystems: drive every bolt to torque (hold the mouse
// on a bolt and let go in the green band). Electronics: wire each device to a PDH channel of the
// right size, crimp the connectors on time, then run the CAN bus from the controller to the PDH.

export class AssemblyOp extends Op {
  constructor(ctx) {
    super(ctx);
    this.sub = ctx.sub;
  }

  enter() {
    this.shop = this.ctx.shop;
    this.shop.showRobot(this.sub);
    this.yaw = 0.6; this.zoom = 1;
    this.results = [];
    if (this.sub === 'controls') this.wiring();
    else this.bolts();
  }

  // ---------- Bolts ----------
  bolts() {
    const grp = this.shop.wip.subs[this.sub];
    grp.updateWorldMatrix(true, true);
    // Bounds in the robot's own frame, so the bolts sit on the parts even though the robot is turned.
    const inv = grp.matrixWorld.clone().invert(), box = new THREE.Box3(), tmp = new THREE.Box3();
    grp.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
    });
    const n = { frame: 12, drive: 8, intake: 6, hopper: 6, shooter: 8, climber: 4, bumpers: 6 }[this.sub] || 6;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, side = i % 4;
      const x = side < 2 ? THREE.MathUtils.lerp(box.min.x, box.max.x, (u * 4) % 1) : side === 2 ? box.min.x : box.max.x;
      const z = side < 2 ? (side === 0 ? box.min.z : box.max.z) : THREE.MathUtils.lerp(box.min.z, box.max.z, (u * 4) % 1);
      pts.push(new THREE.Vector3(x, box.max.y + 0.005, z).applyMatrix4(grp.matrixWorld));
    }
    this.boltList = pts.map((p) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), mats.bolt);
      m.position.copy(p);
      this.shop.root.add(m);
      this.objs.push([m, this.shop.root]);
      return { m, done: false };
    });
    this.center = box.getCenter(new THREE.Vector3()).applyMatrix4(grp.matrixWorld);
    this.torque = 0; this.holding = null;
    this.render();
  }

  render() {
    if (this.sub === 'controls') return;
    const left = this.boltList.filter((b) => !b.done).length;
    this.panel({
      title: `組裝 · ${SUBS[this.sub].name}`,
      info: `鎖上 ${this.boltList.length} 顆螺絲（剩 ${left}）。品質由零件品質和你的組裝決定。`,
      steps: ['把零件擺到位置上（藍色半透明）', '按住螺絲讓扭力上升，在綠色區放開'],
      hint: '滑鼠左鍵按住螺絲 · A／D 或右鍵拖曳旋轉視角 · 滾輪縮放',
    });
    this.step = 1;
  }

  mouse(type, e) {
    if (this.sub === 'controls') return;
    if (type === 'move' && e.buttons & 2) this.yaw -= e.movementX * 0.006;
    if (type === 'down' && e.button === 0) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), this.ctx.camera);
      const hit = ray.intersectObjects(this.boltList.filter((b) => !b.done).map((b) => b.m))[0];
      if (hit) { this.holding = this.boltList.find((b) => b.m === hit.object); this.torque = 0; }
    }
    if (type === 'up' && e.button === 0 && this.holding) this.release();
  }

  release() {
    const b = this.holding, t = this.torque;
    this.holding = null;
    if (!b) return;
    b.done = true;
    let q;
    if (t >= 1) { q = 0.35; b.m.material = mats.bad; this.msg('滑牙了！', 'bad'); }
    else if (t >= 0.72 && t <= 0.92) { q = 1; b.m.material = mats.ok; this.msg('剛好', 'ok'); }
    else { q = t < 0.72 ? 0.55 + t * 0.4 : 0.8; b.m.material = mats.bad; this.msg(t < 0.72 ? '太鬆了' : '有點太緊', 'bad'); }
    this.results.push(q);
    this.render();
    if (this.boltList.every((x) => x.done)) {
      const avg = this.results.reduce((a, v) => a + v, 0) / this.results.length;
      setTimeout(() => this.finish(avg, `${this.results.filter((v) => v === 1).length}/${this.results.length} 顆扭力正確`), 900);
    }
  }

  // ---------- Electronics ----------
  wiring() {
    const a = this.ctx.g.design.adv, motors = this.ctx.motors;
    this.devs = [];
    for (const [sub, n] of Object.entries(motors)) for (let i = 0; i < n; i++) this.devs.push({ name: `${SUBS[sub].name}馬達 ${i + 1}`, big: true });
    this.devs.push({ name: 'roboCore 主控制器', big: false }, { name: '無線電', big: false }, { name: '陀螺儀', big: false });
    this.chans = Array.from({ length: Math.max(20, this.devs.length) + 3 }, (_, i) => ({ n: i + 1, big: i < Math.max(20, this.devs.length), dev: null }));
    this.stage = 0;
    this.drag = null;
    this.crimps = [];
    this.can = [];
    this.cv = overlayCanvas(this.ctx.hud);
    this.cv.c.style.pointerEvents = 'auto';
    this.cv.c.addEventListener('pointerdown', (e) => this.wDown(e));
    this.cv.c.addEventListener('pointermove', (e) => { this.mp = this.pt(e); this.wDraw(); });
    this.cv.c.addEventListener('pointerup', (e) => this.wUp(e));
    void a;
    this.wPanel();
  }

  wPanel() {
    this.panel({
      title: '組裝 · 電控配線',
      info: '馬達接 40A 大電流通道（1–20），控制器、無線電、陀螺儀接 15A 小電流通道。',
      steps: ['從 PDH 通道拖線到每個裝置', '壓接端子：指針到綠色區時按 Space', 'CAN 匯流排：從主控制器開始，依序點每個裝置，最後點 PDH'],
      hint: ['拖曳：通道 → 裝置', 'Space 壓接', '依序點擊裝置'][this.stage],
    });
    this.step = this.stage;
    this.wDraw();
  }

  pt(e) { const r = this.cv.c.getBoundingClientRect(), d = devicePixelRatio; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; }
  layout() {
    const c = this.cv.c, d = devicePixelRatio, W = c.width * 0.64;
    const ch = (i) => [60 * d, 60 * d + i * ((c.height - 120 * d) / this.chans.length)];
    const dv = (i) => [W - 260 * d, 60 * d + i * ((c.height - 120 * d) / this.devs.length)];
    return { ch, dv, d, W, pdh: [60 * d, c.height - 40 * d] };
  }
  hitList(p, list, pos, w) {
    const d = devicePixelRatio;
    return list.findIndex((_, i) => { const [x, y] = pos(i); return p[0] > x - 10 * d && p[0] < x + w * d && Math.abs(p[1] - y) < 9 * d; });
  }
  wDown(e) {
    const p = this.pt(e), L = this.layout();
    if (this.stage === 0) { const i = this.hitList(p, this.chans, L.ch, 70); if (i >= 0 && !this.chans[i].dev) this.drag = i; }
    if (this.stage === 2) {
      const i = this.hitList(p, this.devs, L.dv, 220);
      const dev = this.devs[i];
      if (dev && !this.can.includes(dev)) {
        if (!this.can.length && !dev.name.startsWith('roboCore')) { this.msg('從主控制器開始', 'bad'); return; }
        if (dev.name === '無線電') { this.msg('無線電不在 CAN 上（用網路線）', 'bad'); return; }
        this.can.push(dev);
      } else if (Math.hypot(p[0] - L.pdh[0], p[1] - L.pdh[1]) < 40 * L.d) this.canDone();
      this.wDraw();
    }
  }
  wUp(e) {
    if (this.stage !== 0 || this.drag === null) return;
    const p = this.pt(e), L = this.layout(), i = this.hitList(p, this.devs, L.dv, 220);
    if (i >= 0 && !this.chans.some((c) => c.dev === this.devs[i])) this.chans[this.drag].dev = this.devs[i];
    this.drag = null;
    if (this.devs.every((dv) => this.chans.some((c) => c.dev === dv))) { this.stage = 1; this.crimpT = 0; this.wPanel(); }
    this.wDraw();
  }
  key(code, down) {
    super.key(code, down);
    if (!down || this.sub !== 'controls' || this.stage !== 1 || code !== 'Space') return;
    const v = (Math.sin(this.crimpT * 3.2) + 1) / 2;
    this.crimps.push(Math.abs(v - 0.5) < 0.12 ? 1 : Math.abs(v - 0.5) < 0.25 ? 0.75 : 0.4);
    this.msg(this.crimps[this.crimps.length - 1] === 1 ? '壓得漂亮' : '有點歪', this.crimps[this.crimps.length - 1] === 1 ? 'ok' : 'bad');
    if (this.crimps.length >= this.devs.length) { this.stage = 2; this.wPanel(); }
  }
  canDone() {
    const onBus = this.devs.filter((dv) => dv.name !== '無線電');
    const missing = onBus.filter((dv) => !this.can.includes(dv)).length;
    const wrong = this.chans.filter((c) => c.dev && c.dev.big !== c.big).length;
    const crimp = this.crimps.reduce((a, v) => a + v, 0) / this.crimps.length;
    const q = clamp(crimp - wrong * 0.08 - missing * 0.06, 0, 1);
    this.stage = 3;
    this.finish(q, `${wrong ? `${wrong} 條線接錯通道、` : ''}${missing ? `${missing} 個裝置沒接上 CAN、` : ''}壓接 ${Math.round(crimp * 100)}%`);
  }

  wDraw() {
    if (!this.cv) return;
    const { c, x } = this.cv, L = this.layout(), d = L.d;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(10,12,16,.85)'; x.fillRect(0, 0, L.W, c.height);
    x.font = `${12 * d}px system-ui`; x.textBaseline = 'middle';
    this.chans.forEach((ch, i) => {
      const [px, py] = L.ch(i);
      x.fillStyle = ch.big ? '#c0392b' : '#e67e22'; x.fillRect(px - 8 * d, py - 7 * d, 60 * d, 14 * d);
      x.fillStyle = '#fff'; x.fillText(`${ch.n} · ${ch.big ? '40A' : '15A'}`, px - 4 * d, py);
    });
    this.devs.forEach((dv, i) => {
      const [px, py] = L.dv(i);
      x.fillStyle = this.can.includes(dv) ? '#2f9e5b' : '#30343c'; x.fillRect(px - 8 * d, py - 7 * d, 220 * d, 14 * d);
      x.fillStyle = '#fff'; x.fillText(dv.name, px - 2 * d, py);
    });
    x.lineWidth = 2 * d;
    this.chans.forEach((ch, i) => {
      if (!ch.dev) return;
      const a = L.ch(i), b = L.dv(this.devs.indexOf(ch.dev));
      x.strokeStyle = ch.dev.big === ch.big ? '#ef4444' : '#f59f00';
      x.beginPath(); x.moveTo(a[0] + 52 * d, a[1]); x.bezierCurveTo(a[0] + 200 * d, a[1], b[0] - 150 * d, b[1], b[0] - 8 * d, b[1]); x.stroke();
    });
    if (this.drag !== null && this.mp) { const a = L.ch(this.drag); x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(a[0] + 52 * d, a[1]); x.lineTo(this.mp[0], this.mp[1]); x.stroke(); }
    if (this.can.length) {
      x.strokeStyle = '#f2c230'; x.setLineDash([5 * d, 3 * d]); x.beginPath();
      this.can.forEach((dv, k) => { const [px, py] = L.dv(this.devs.indexOf(dv)); if (k) x.lineTo(px + 215 * d, py); else x.moveTo(px + 215 * d, py); });
      x.stroke(); x.setLineDash([]);
    }
    if (this.stage === 2) { x.fillStyle = '#c0392b'; x.beginPath(); x.arc(L.pdh[0], L.pdh[1], 24 * d, 0, 7); x.fill(); x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText('PDH', L.pdh[0], L.pdh[1]); x.textAlign = 'left'; }
    if (this.stage === 1) {
      const cx = L.W / 2, cy = c.height / 2, v = (Math.sin(this.crimpT * 3.2) + 1) / 2;
      x.fillStyle = '#20232a'; x.fillRect(cx - 160 * d, cy - 50 * d, 320 * d, 100 * d);
      x.fillStyle = '#2f9e5b'; x.fillRect(cx - 160 * d + 320 * d * 0.38, cy - 10 * d, 320 * d * 0.24, 20 * d);
      x.fillStyle = '#fff'; x.fillRect(cx - 160 * d + 320 * d * v - 2 * d, cy - 22 * d, 4 * d, 44 * d);
      x.textAlign = 'center'; x.fillText(`壓接端子 ${this.crimps.length + 1} / ${this.devs.length}`, cx, cy - 34 * d); x.textAlign = 'left';
    }
  }

  update(dt) {
    super.update(dt);
    if (this.sub === 'controls') { if (this.stage === 1) { this.crimpT += dt; this.wDraw(); } this.camCart(); return; }
    if (this.held('KeyA')) this.yaw += dt * 1.2;
    if (this.held('KeyD')) this.yaw -= dt * 1.2;
    if (this.holding) { this.torque += dt * 0.85; if (this.torque >= 1.05) this.release(); }
    for (const b of this.boltList) if (!b.done) b.m.scale.setScalar(this.holding === b ? 1 + this.torque * 0.4 : 1 + Math.sin(this.time * 5) * 0.12);
    this.camCart();
    if (this.holding) this.read(`扭力 <span class="op-meter torque"><i style="width:${Math.min(100, this.torque * 100)}%"></i><em></em></span>`);
    else this.read('');
  }
  camCart() {
    const c = this.center || this.shop.cartM.group.position.clone().setY(0.9), r = 1.15 * this.zoom;
    const cam = this.ctx.camera;
    cam.position.set(c.x + Math.sin(this.yaw) * r, c.y + 0.75 * this.zoom, c.z + Math.cos(this.yaw) * r);
    cam.lookAt(c);
  }

  exit() { this.shop.showRobot(null); super.exit(); }
}
