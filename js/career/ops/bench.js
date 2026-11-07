import { Op, clamp, overlayCanvas } from './base.js';

// Workbench: deburr a part with a file (drag along the edges at an even pace, don't keep filing
// clean edges), or tap the ends of a hex shaft (turn the tap clockwise in circles and back it off
// every half turn to break the chip, or it snaps).

export class BenchOp extends Op {
  enter() {
    this.tap = this.p.kind === 'hex';
    this.cv = overlayCanvas(this.ctx.hud);
    this.cv.c.style.pointerEvents = 'auto';
    this.cv.c.addEventListener('pointerdown', (e) => { this.down = true; this.last = this.pt(e); this.lastT = performance.now(); });
    addEventListener('pointerup', this.up = () => { this.down = false; });
    this.cv.c.addEventListener('pointermove', (e) => this.move(e));
    if (this.tap) {
      this.end = 0; this.turns = 0; this.stress = 0; this.peak = 0; this.angle = null; this.need = 6;
    } else {
      const s = this.p.spec;
      const w = s.w || s.len, h = s.h || (this.p.mat === 'tube1x1' ? 1 : 2);
      this.size = [w, h];
      this.segs = [];
      const per = (a, b) => Math.max(3, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5));
      const corners = [[0, 0], [w, 0], [w, h], [0, h]];
      for (let k = 0; k < 4; k++) {
        const a = corners[k], b = corners[(k + 1) % 4], n = per(a, b);
        for (let i = 0; i < n; i++) this.segs.push({ x: a[0] + (b[0] - a[0]) * (i + 0.5) / n, y: a[1] + (b[1] - a[1]) * (i + 0.5) / n, burr: 0.6 + Math.random() * 0.4, over: 0 });
      }
      this.holes = (s.holes || []).map((hh) => (Array.isArray(hh) ? { x: hh[0], y: hh[1], t: 0 } : { x: hh, y: h / 2, t: 0 })).filter((hh) => hh.x <= w);
      this.slips = 0;
    }
    this.render();
    this.cam([0.6, 1.5, 0.75], [0.6, 0.93, 0.25]);
  }

  render() {
    this.panel(this.tap ? {
      title: `工作台 · 攻牙 · ${this.p.name}`,
      info: `兩端各攻 ${this.need} 圈（10-32 螺紋）`,
      steps: ['第一端攻牙', '第二端攻牙'],
      hint: '按住滑鼠，繞著中心順時針畫圈＝往下攻；逆時針倒轉一點可以斷屑、降低阻力',
    } : {
      title: `工作台 · 去毛邊 · ${this.p.name}`,
      info: `${this.segs.length} 段邊緣、${this.holes.length} 個孔`,
      steps: ['用銼刀順著邊緣推，把黃色毛邊去掉', '每個孔用去毛邊刀轉一下（按住孔約半秒）'],
      hint: '按住滑鼠沿邊緣拖曳；太快會打滑，乾淨的邊不要一直銼',
    });
    this.step = this.tap ? this.end : this.segs.every((s) => s.burr < 0.1) ? 1 : 0;
  }

  pt(e) { const r = this.cv.c.getBoundingClientRect(), d = devicePixelRatio; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; }
  view() {
    const c = this.cv.c, W = c.width * 0.64, H = c.height, pad = 70 * devicePixelRatio;
    const s = Math.min((W - pad * 2) / this.size[0], (H - pad * 2) / this.size[1], 90 * devicePixelRatio);
    const ox = (W - this.size[0] * s) / 2, oy = (H + this.size[1] * s) / 2;
    return { s, X: (x) => ox + x * s, Y: (y) => oy - y * s };
  }

  move(e) {
    if (!this.down || this.over) return;
    const p = this.pt(e), now = performance.now();
    const dt = Math.max(1, now - this.lastT) / 1000, d = devicePixelRatio;
    if (this.tap) {
      const c = this.cv.c, cx = c.width * 0.32, cy = c.height * 0.5;
      const a = Math.atan2(p[1] - cy, p[0] - cx);
      if (this.angle !== null) {
        let da = a - this.angle;
        if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
        const t = da / (Math.PI * 2);
        if (t > 0) { this.turns += t; this.stress += t * (1.6 + this.turns * 0.12); }
        else { this.turns = Math.max(0, this.turns + t * 0.3); this.stress = Math.max(0, this.stress + t * 6); }
        this.peak = Math.max(this.peak, this.stress);
        if (this.stress > 1) { this.ctx.breakTool('bench'); this.msg('螺絲攻斷在孔裡了！這根軸報廢。', 'bad'); this.over = true; setTimeout(() => this.finish(0.1, '螺絲攻斷了'), 1500); }
        if (this.turns >= this.need) {
          this.end++; this.turns = 0; this.stress = 0; this.angle = null;
          this.msg(this.end === 1 ? '第一端完成，換另一端' : '兩端都攻好了', 'ok');
          this.render();
          if (this.end >= 2) { this.over = true; const q = clamp(1.05 - Math.max(0, this.peak - 0.6) * 1.2, 0, 1); setTimeout(() => this.finish(q, `最大阻力 ${Math.round(this.peak * 100)}%`), 1000); }
          return;
        }
      }
      this.angle = a;
    } else {
      const v = this.view(), speed = Math.hypot(p[0] - this.last[0], p[1] - this.last[1]) / dt / d;
      const len = Math.hypot(p[0] - this.last[0], p[1] - this.last[1]) / v.s;
      if (speed > 1600) { this.slips++; this.msg('太快了，銼刀打滑', 'bad'); }
      else for (const s of this.segs) {
        const dx = v.X(s.x) - p[0], dy = v.Y(s.y) - p[1];
        if (Math.hypot(dx, dy) > 16 * d) continue;
        if (s.burr > 0) s.burr = Math.max(0, s.burr - len * 0.9);
        else s.over += len;
      }
      for (const h of this.holes) if (Math.hypot(v.X(h.x) - p[0], v.Y(h.y) - p[1]) < 10 * d) h.t += dt;
      this.render();
      this.checkDone();
    }
    this.last = p; this.lastT = now;
    this.draw();
  }

  checkDone() {
    if (this.over || this.segs.some((s) => s.burr > 0.08) || this.holes.some((h) => h.t < 0.45)) return;
    this.over = true;
    const over = this.segs.reduce((a, s) => a + s.over, 0) / this.segs.length;
    const q = clamp(1 - over * 0.25 - this.slips * 0.02, 0.4, 1);
    this.msg('毛邊都去乾淨了', 'ok');
    setTimeout(() => this.finish(q, over > 0.5 ? '有些邊銼過頭了' : '邊緣乾淨'), 900);
  }

  update(dt) {
    super.update(dt);
    if (this.held('Mouse')) this.down = true;
    // Holding the deburr tool still on a hole counts too.
    if (!this.tap && this.down && this.last && !this.over) {
      const v = this.view(), d = devicePixelRatio;
      for (const h of this.holes) if (Math.hypot(v.X(h.x) - this.last[0], v.Y(h.y) - this.last[1]) < 10 * d) h.t += dt;
      this.checkDone();
    }
    if (this.tap) this.stress = Math.max(0, this.stress - dt * 0.05);
    this.draw();
  }

  draw() {
    const { c, x } = this.cv, d = devicePixelRatio;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(10,12,16,.78)'; x.fillRect(0, 0, c.width * 0.64, c.height);
    if (this.tap) {
      const cx = c.width * 0.32, cy = c.height * 0.5, R = Math.min(c.width, c.height) * 0.22;
      x.strokeStyle = '#3b4252'; x.lineWidth = 2 * d; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke();
      x.fillStyle = '#c4cad1'; x.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; x.lineTo(cx + Math.cos(a) * R * 0.35, cy + Math.sin(a) * R * 0.35); }
      x.fill();
      const a = (this.turns % 1) * Math.PI * 2 - Math.PI / 2;
      x.strokeStyle = '#f2c230'; x.lineWidth = 8 * d; x.beginPath(); x.moveTo(cx - Math.cos(a) * R * 0.9, cy - Math.sin(a) * R * 0.9); x.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9); x.stroke();
      x.fillStyle = '#fff'; x.font = `${16 * d}px system-ui`; x.textAlign = 'center';
      x.fillText(`第 ${Math.min(2, this.end + 1)} 端：${this.turns.toFixed(1)} / ${this.need} 圈`, cx, cy + R + 36 * d);
      x.fillStyle = '#333'; x.fillRect(cx - 120 * d, cy - R - 50 * d, 240 * d, 14 * d);
      x.fillStyle = this.stress > 0.75 ? '#ef4444' : this.stress > 0.5 ? '#f59f00' : '#22c55e';
      x.fillRect(cx - 120 * d, cy - R - 50 * d, 240 * d * Math.min(1, this.stress), 14 * d);
      x.fillStyle = '#fff'; x.fillText('阻力', cx, cy - R - 58 * d);
      return;
    }
    const v = this.view();
    x.fillStyle = this.p.kind === 'poly' ? '#c7dcf0' : '#c4cad1';
    x.fillRect(v.X(0), v.Y(this.size[1]), this.size[0] * v.s, this.size[1] * v.s);
    for (const h of this.holes) {
      x.fillStyle = '#222'; x.beginPath(); x.arc(v.X(h.x), v.Y(h.y), 5 * d, 0, 7); x.fill();
      if (h.t < 0.45) { x.strokeStyle = '#f2c230'; x.lineWidth = 2 * d; x.beginPath(); x.arc(v.X(h.x), v.Y(h.y), 8 * d, 0, 7); x.stroke(); }
    }
    for (const s of this.segs) {
      if (s.burr > 0.08) { x.fillStyle = `rgba(242,194,48,${0.4 + s.burr * 0.6})`; x.beginPath(); x.arc(v.X(s.x), v.Y(s.y), (4 + s.burr * 5) * d, 0, 7); x.fill(); }
      else if (s.over > 0.6) { x.fillStyle = 'rgba(239,68,68,.6)'; x.beginPath(); x.arc(v.X(s.x), v.Y(s.y), 3 * d, 0, 7); x.fill(); }
    }
  }

  exit() { removeEventListener('pointerup', this.up); super.exit(); }
  wheel() {}
}
