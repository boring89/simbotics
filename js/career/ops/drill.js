import * as THREE from '../../three.js';
import { Op, IN, clamp, mats, stockMat, section } from './base.js';

// Drill press: move the table until the punch mark sits under the laser cross, pick the spindle
// speed, then pull the handle down (drag the mouse down) and peck to clear chips. Hole position
// error decides the quality.

const RPMS = [600, 1200, 2400, 3600];
const BIT = 0.201;   // #7 drill for 1/4-20 / #10 clearance, in

export class DrillOp extends Op {
  enter() {
    const p = this.p, s = p.spec, [w, t] = section(p);
    this.isTube = p.kind === 'tube';
    this.W = this.isTube ? Math.min(s.len, 30) : s.w;          // in, along x
    this.H = this.isTube ? w : s.h;                            // in, along z
    this.T = this.isTube ? t : t;                              // in
    this.holes = (this.isTube ? s.holes.filter((x) => x <= this.W).map((x) => [x, w / 2]) : s.holes).map(([x, y]) => ({ x, y, done: false, err: 0 }));
    if (!this.holes.length) this.holes = [{ x: this.W / 2, y: this.H / 2, done: false, err: 0 }];
    // Walls the bit goes through (tubes: top and bottom wall).
    this.walls = this.isTube ? [[0, 0.1], [t - 0.1, t]] : [[0, t]];
    this.rpm = 1;
    this.motor = false;
    this.depth = -0.25;      // in: bit tip below the top surface (negative = above)
    this.chips = 0;
    this.heat = 0;
    this.rate = 0; this.cutAcc = 0;
    this.ox = -this.holes[0].x + this.W / 2 + 0.6;   // table offset in inches
    this.oz = -(this.holes[0].y - this.H / 2) - 0.4;
    this.cur = null;
    this.broken = 0;
    const top = this.m.top;
    const g = new THREE.Group();
    g.position.y = top;
    this.add(g);
    this.table = g;
    const work = new THREE.Group();
    g.add(work);
    this.work = work;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(this.W * IN, this.T * IN, this.H * IN), stockMat(p));
    plate.position.y = this.T * IN / 2;
    work.add(plate);
    this.marks = this.holes.map((h) => {
      const m = new THREE.Group();
      for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.0003, 0.0006), mats.mark); b.rotation.y = r; m.add(b); }
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0007, 10), mats.mark);
      dot.rotation.x = -Math.PI / 2; dot.position.y = 0.0002;
      m.add(dot);
      m.position.set((h.x - this.W / 2) * IN, this.T * IN + 0.0003, (h.y - this.H / 2) * IN);
      work.add(m);
      return m;
    });
    // The laser cross is fixed to the machine, on the work surface.
    this.laser = new THREE.Group();
    for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.0002, 0.0004), mats.laser); b.rotation.y = r; this.laser.add(b); }
    this.laser.position.set(0, top + this.T * IN + 0.0006, 0);
    this.add(this.laser);
    this.render();
  }

  render() {
    const left = this.holes.filter((h) => !h.done).length;
    this.step = !this.motor ? 0 : 1;
    this.panel({
      title: `台鑽 · ${this.p.name}`,
      info: `鑽 ${this.holes.length} 個孔（剩 ${left}）· 鑽頭 #7（${BIT} in）· 鋁件建議 2400–3600 RPM`,
      steps: ['選轉速（1–4）並開機（E）', '移動工作台，讓衝點對準雷射十字', '往下拖曳滑鼠下鑽；每鑽一段就放開退屑'],
      hint: 'WASD 移動工作台（Shift 微調）· 1–4 轉速 · E 開關 · 按住左鍵往下拖＝下鑽 · 滾輪縮放',
    });
  }

  key(code, down) {
    super.key(code, down);
    if (!down) return;
    const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
    if (i >= 0) { if (this.depth > 0) this.msg('鑽頭還在工件裡，先退出來', 'bad'); else { this.rpm = i; this.msg(`轉速 ${RPMS[i]} RPM`); } }
    if (code === 'KeyE') { this.motor = !this.motor; this.msg(this.motor ? `主軸啟動 ${RPMS[this.rpm]} RPM` : '主軸停止'); this.render(); }
  }

  mouse(type, e) {
    if (type === 'down' && e.button === 0) this.pull = true;
    if (type === 'up' && e.button === 0) this.pull = false;
    if (type === 'move' && this.pull) this.feed(e.movementY * 0.004);
  }

  feed(d) {
    if (d <= 0) { this.depth = Math.max(-0.4, this.depth + d * 3); return; }
    const before = this.depth;
    this.depth = Math.min(this.T + 0.08, this.depth + d);
    if (this.depth <= 0) return;
    // Which hole: the one under the bit (a half-drilled hole elsewhere stays as it is).
    if (this.cur && this.offset(this.cur) > 0.05) this.cur = null;
    const h = this.cur || this.nearest();
    const from = Math.max(before, h.drilled || 0);
    const inMat = this.walls.reduce((s, [a, b]) => s + Math.max(0, Math.min(this.depth, b) - Math.max(from, a)), 0);
    if (inMat <= 0) return;
    if (!this.cur) {
      // First touch: lock the hole position, check the spindle.
      this.cur = h;
      h.err = h.d;
      if (!this.motor) { this.crash('主軸沒開就下鑽，鑽頭斷了！'); return; }
    }
    h.drilled = Math.max(h.drilled || 0, this.depth);
    this.chips += inMat;
    this.cutAcc += inMat;
    if (this.chips > 0.24) this.crash('切屑卡住，鑽頭斷了！要記得退屑。');
    else if (this.chips > 0.15) this.msg('切屑快卡住了，放開退屑', 'bad');
  }

  crash(text) {
    this.msg(text, 'bad');
    this.ctx.breakTool('drill');
    this.broken++;
    this.depth = -0.3; this.pull = false; this.chips = 0; this.heat = 0;
    if (this.cur) { this.cur.err += 0.03; }
    if (this.g.tools.bits <= 0) { this.msg('沒有鑽頭了，去 MakerMart 買', 'bad'); setTimeout(() => this.ctx.cancel(), 1500); }
  }

  offset(h) { return Math.hypot((h.x - this.W / 2) + this.ox, (h.y - this.H / 2) + this.oz); }
  nearest() {
    let best = null;
    for (const h of this.holes) {
      if (h.done) continue;
      const x = (h.x - this.W / 2) + this.ox, z = (h.y - this.H / 2) + this.oz;
      const d = Math.hypot(x, z);
      if (!best || d < best.d) best = Object.assign(h, { d });
    }
    return best;
  }

  update(dt) {
    super.update(dt);
    // Feed rate (in/s of metal removed), smoothed; pushing too hard or too slow a spindle heats the bit.
    this.rate += (this.cutAcc / Math.max(dt, 1e-3) - this.rate) * Math.min(1, dt * 8);
    this.cutAcc = 0;
    this.heat = Math.max(0, this.heat + (Math.max(0, this.rate - 0.35) * 2.2 + (this.rpm < 2 ? this.rate * 1.5 : 0) - 0.25) * dt);
    if (this.heat > 1) this.crash('下鑽太猛，鑽頭燒斷了！');
    else if (this.heat > 0.6 && this.rate > 0.35) this.msg('太快了，慢一點', 'bad');
    const fine = this.held('ShiftLeft') || this.held('ShiftRight');
    const sp = (fine ? 0.06 : 0.9) * dt;
    if (this.depth <= 0) {
      if (this.held('KeyA')) this.ox -= sp; if (this.held('KeyD')) this.ox += sp;
      if (this.held('KeyW')) this.oz -= sp; if (this.held('KeyS')) this.oz += sp;
      this.ox = clamp(this.ox, -this.W / 2 - 2, this.W / 2 + 2); this.oz = clamp(this.oz, -this.H / 2 - 2, this.H / 2 + 2);
    }
    // Released: the quill springs back up; chips clear once the bit is out.
    if (!this.pull) this.depth = Math.max(-0.4, this.depth - 2.5 * dt);
    if (this.depth < 0) { this.chips = 0; this.heat = Math.max(0, this.heat - dt * 0.6); }
    if (this.cur && this.depth >= this.T + 0.02) {
      this.cur.done = true;
      const m = this.marks[this.holes.indexOf(this.cur)];
      const hole = new THREE.Mesh(new THREE.CircleGeometry(BIT * IN / 2, 16), mats.hole);
      hole.rotation.x = -Math.PI / 2; hole.position.copy(m.position); hole.position.y += 0.0004;
      // Show where the hole really went.
      const ex = -(this.ox + (this.cur.x - this.W / 2)), ez = -(this.oz + (this.cur.y - this.H / 2));
      hole.position.x += ex * IN; hole.position.z += ez * IN;
      this.work.add(hole);
      m.visible = false;
      this.msg(`孔偏 ${this.cur.err.toFixed(3)} in`, this.cur.err < 0.02 ? 'ok' : 'bad');
      this.cur = null;
      this.render();
      if (this.holes.every((h) => h.done)) this.done();
    }
    // Move things.
    this.table.position.x = this.m.vise.position.x = this.ox * IN;
    this.table.position.z = this.m.vise.position.z = this.oz * IN;
    const tipRest = this.m.quillY - 0.255;   // bit tip height when the quill is up
    this.m.quill.position.y = this.m.quillY + (this.m.top + this.T * IN - this.depth * IN) - tipRest;
    this.m.wheel.rotation.x = -this.depth * 0.8;
    this.m.bit.rotation.y += this.motor ? dt * RPMS[this.rpm] * 0.05 : 0;
    const z = 0.2 * this.zoom;
    this.cam([0.002, this.m.top + z * 0.55, z * 0.85 + 0.02], [0, this.m.top, 0]);
    this.read(`轉速 <b class="${this.rpm >= 2 ? 'ok' : 'bad'}">${RPMS[this.rpm]} RPM</b> ${this.motor ? '· 運轉中' : '· 停止'}<br>切屑 <span class="op-meter"><i style="width:${Math.min(100, this.chips / 0.24 * 100)}%"></i></span> 溫度 <span class="op-meter"><i style="width:${Math.min(100, this.heat * 100)}%"></i></span>`);
  }

  done() {
    const avg = this.holes.reduce((s, h) => s + h.err, 0) / this.holes.length;
    const q = clamp(1 - avg * 9 - (this.rpm < 2 ? 0.12 : 0) - this.broken * 0.05, 0, 1);
    this.motor = false;
    setTimeout(() => this.finish(q, `平均孔偏 ${avg.toFixed(3)} in`), 1100);
  }

  exit() { this.m.quill.position.y = this.m.quillY; this.m.vise.position.set(0, 0.915, 0); super.exit(); }
}
