import * as THREE from '../../three.js';
import { Op, IN, clamp, mats, stockMat, section } from './base.js';

// Band saw: measure and scribe the cut, line the blade up on the waste side of the line, then
// feed the stock through at a steady rate. Length error decides the quality.

const KERF = 0.035;

export class BandOp extends Op {
  constructor(ctx) {
    super(ctx);
    const p = this.p, s = p.spec, [w, t] = section(p);
    // Plates get two cuts (strip, then length); bars and tubes one.
    this.cuts = p.kind === 'plate' || p.kind === 'poly'
      ? [{ len: s.h, depth: Math.min(8, s.w + 1), w: Math.min(8, s.w + 1), t }, { len: s.w, depth: Math.min(8, s.h), w: s.h, t }]
      : [{ len: s.len, depth: w, w, t }];
    this.k = 0;
    this.errs = [];
    this.motor = false;
    this.broke = false;
  }

  enter() { this.setupCut(); }

  setupCut() {
    const c = this.cuts[this.k];
    for (const [o, parent] of this.objs) parent.remove(o);
    this.objs = [];
    this.stage = 'mark';
    this.pencil = Math.round(c.len) - 1.3 + Math.random() * 0.4;
    this.mark = null;
    this.travel = 0;
    this.v = 0;
    this.drift = 0;
    this.fast = 0;
    const visible = c.len + 10;
    const g = new THREE.Group();
    const top = this.m.table;
    const geo = this.p.kind === 'hex' ? new THREE.CylinderGeometry(c.w * IN / 2, c.w * IN / 2, visible * IN, 6) : new THREE.BoxGeometry(visible * IN, c.t * IN, c.w * IN);
    const bar = new THREE.Mesh(geo, stockMat(this.p));
    if (this.p.kind === 'hex') bar.rotation.z = Math.PI / 2;
    bar.position.set(visible * IN / 2, (this.p.kind === 'hex' ? c.w : c.t) * IN / 2, 0);
    g.add(bar);
    g.position.set(0, top, 0.05 + c.w * IN / 2);
    this.add(g);
    this.stock = g;
    this.bar = bar;
    this.thick = (this.p.kind === 'hex' ? c.w : c.t) * IN;
    this.stage0();
  }

  stage0() {
    const c = this.cuts[this.k];
    this.step = 0;
    this.render();
    // The tape measure.
    const cv = document.createElement('canvas');
    cv.className = 'op-ruler';
    cv.width = 720; cv.height = 130;
    this.ctx.hud.appendChild(cv);
    this.ruler = cv;
    cv.addEventListener('pointermove', (e) => { if (e.buttons & 1 && this.stage === 'mark') { this.pencil += e.movementX / 140; this.drawRuler(); } });
    this.drawRuler();
    this.cam([0.25, this.m.table + 0.5, 0.45], [0.2, this.m.table, 0.05]);
    this.stock.position.x = -0.2;
    void c;
  }

  render() {
    const c = this.cuts[this.k];
    this.panel({
      title: `帶鋸機 · ${this.p.name}`,
      info: `圖面：${this.cuts.length > 1 ? `第 ${this.k + 1}/2 刀，` : ''}長度 <b>${c.len} in</b>`,
      steps: ['用捲尺量長度、劃線', '把線對到鋸片：鋸片在線的右側（廢料側）', '開機（E），穩定送料（按住 W 或滑鼠左鍵）'],
      hint: this.stage === 'mark' ? '拖曳捲尺上的鉛筆（或 ← →，按住 Shift 微調），Space 劃線'
        : this.stage === 'align' ? 'A／D 移動工件（Shift 微調），滑鼠滾輪縮放，Space 確定'
          : 'E 開／關鋸機，按住 W 或滑鼠左鍵送料，不要推太快',
    });
  }

  drawRuler() {
    const c = this.ruler, x = c.getContext('2d'), s = 140, w = c.width, p = this.pencil;
    x.fillStyle = '#f2c230'; x.fillRect(0, 0, w, c.height);
    x.fillStyle = '#111'; x.font = 'bold 18px system-ui'; x.textAlign = 'center';
    const from = Math.floor(p - w / s / 2) - 1, to = Math.ceil(p + w / s / 2) + 1;
    for (let i = from * 16; i <= to * 16; i++) {
      const v = i / 16, px = w / 2 + (v - p) * s;
      if (px < 0 || px > w || v < 0) continue;
      const h = i % 16 === 0 ? 60 : i % 8 === 0 ? 44 : i % 4 === 0 ? 32 : i % 2 === 0 ? 22 : 14;
      x.fillRect(px - 1, 0, i % 16 === 0 ? 2.5 : 1.5, h);
      if (i % 16 === 0) x.fillText(String(v), px, 84);
    }
    x.fillStyle = '#d62828'; x.fillRect(w / 2 - 1, 0, 2, c.height);
    x.fillStyle = '#333'; x.font = '13px system-ui'; x.textAlign = 'left';
    x.fillText('鉛筆', w / 2 + 6, 120);
  }

  key(code, down) {
    super.key(code, down);
    if (!down) return;
    if (this.stage === 'mark') {
      const f = this.held('ShiftLeft') || this.held('ShiftRight') ? 1 / 64 : 1 / 16;
      if (code === 'ArrowLeft') { this.pencil -= f; this.drawRuler(); }
      if (code === 'ArrowRight') { this.pencil += f; this.drawRuler(); }
      if (code === 'Space') this.scribe();
    } else if (this.stage === 'align' && (code === 'Space' || code === 'Enter')) {
      this.stage = 'cut'; this.step = 2; this.render();
    } else if (this.stage === 'cut' && code === 'KeyE') { this.motor = !this.motor; this.msg(this.motor ? '鋸機啟動' : '鋸機關閉'); }
  }

  scribe() {
    const c = this.cuts[this.k];
    // A steady hand still wobbles a little.
    this.mark = this.pencil + (Math.random() - 0.5) * 0.008;
    this.markErr = this.mark - c.len;
    this.ruler.remove();
    this.ruler = null;
    // Pencil line on the stock.
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.0006, 0.0004, c.w * IN * 1.02), mats.mark);
    line.position.set(this.mark * IN, this.thick + 0.0004, 0);
    this.stock.add(line);
    // Start a little off so it has to be lined up.
    this.ox = -(this.mark + KERF / 2) - (0.25 + Math.random() * 0.6) * (Math.random() < 0.5 ? 1 : -1);
    this.stage = 'align'; this.step = 1; this.zoom = 1;
    this.render();
  }

  mouse(type, e) {
    if (this.stage === 'align' && type === 'move' && e.buttons & 1) this.ox += e.movementX * 0.0015;
    if (type === 'down' && e.button === 0) this.keys.add('Mouse');
    if (type === 'up' && e.button === 0) this.keys.delete('Mouse');
  }

  update(dt) {
    super.update(dt);
    const c = this.cuts[this.k], top = this.m.table;
    this.m.blade.visible = !this.motor || Math.floor(this.time * 40) % 2 === 0;
    if (this.stage === 'mark' || this.stage === 'wait') return;
    if (this.stage === 'align') {
      const sp = this.held('ShiftLeft') || this.held('ShiftRight') ? 0.04 : 0.4;
      if (this.held('KeyA')) this.ox -= sp * dt;
      if (this.held('KeyD')) this.ox += sp * dt;
      this.stock.position.x = this.ox * IN;
      const z = 0.12 * this.zoom;
      this.cam([0.004, top + z * 1.3, z * 0.55 + 0.02], [0, top, 0.02]);
      return;
    }
    // Cutting.
    const push = this.held('KeyW') || this.held('Mouse');
    this.v = push ? Math.min(1.6, this.v + 1.3 * dt) : Math.max(0, this.v - 4 * dt);
    const front = this.stock.position.z - c.w * IN / 2;   // edge facing the blade
    const contact = front <= -0.05 + 0.001;
    if (contact && !this.motor && this.v > 0) { this.v = 0; this.msg('先開鋸機（E）再送料', 'bad'); }
    if (contact && this.motor) {
      if (this.v > 0.95) { this.drift += (this.v - 0.95) * dt * 0.06 * (this.k % 2 ? -1 : 1); this.fast += dt; if (this.fast > 0.25) this.msg('送太快了，鋸片在偏！', 'bad'); }
      else this.fast = Math.max(0, this.fast - dt);
      if (this.v > 1.45 && this.fast > 0.7 && !this.broke) {
        this.broke = true; this.ctx.breakTool('band'); this.drift += 0.12; this.motor = false; this.v = 0;
        this.msg('鋸條斷了！這一刀歪掉了', 'bad');
      }
      this.travel += this.v * dt;
    }
    if (!contact) this.stock.position.z -= this.v * IN * dt * 3;
    else this.stock.position.z = 0.05 + c.w * IN / 2 - 0.1 - this.travel * IN;
    this.stock.position.x = this.ox * IN;
    this.cam([0.18, top + 0.32, 0.36], [0.02, top, -0.02]);
    this.read(`送料速度 <b class="${this.v > 0.95 ? 'bad' : 'ok'}">${this.v.toFixed(2)} in/s</b> · 進度 ${Math.round(clamp(this.travel / c.depth, 0, 1) * 100)}%`);
    if (this.travel >= c.depth) this.cutDone();
  }

  cutDone() {
    const c = this.cuts[this.k];
    const sb = -this.ox;                         // blade centre in stock coordinates
    const err = (sb - KERF / 2) - c.len + this.drift;
    this.errs.push(Math.abs(err));
    this.motor = false;
    this.msg(`量測：${(c.len + err).toFixed(3)} in（誤差 ${err >= 0 ? '+' : ''}${err.toFixed(3)} in）`, Math.abs(err) < 0.04 ? 'ok' : 'bad');
    this.k++;
    if (this.k < this.cuts.length) { setTimeout(() => { if (!this.over) this.setupCut(); }, 1400); this.stage = 'wait'; return; }
    this.stage = 'wait';
    const e = this.errs.reduce((a, b) => a + b, 0) / this.errs.length;
    const q = clamp(1 - e / 0.15, 0, 1) ** 0.85;
    setTimeout(() => this.finish(q, `平均誤差 ${e.toFixed(3)} in`), 1400);
  }

  exit() { this.ruler?.remove(); this.m.blade.visible = true; super.exit(); }
}
