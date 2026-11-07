import { Op, clamp, overlayCanvas } from './base.js';
import { MATERIALS } from '../data.js';

// CNC router setup: clamp the sheet without putting a clamp in the tool path, zero X/Y on the
// sheet's corner with the edge finder, touch off Z with a sheet of paper, set speeds and feeds,
// then start the job. The machine then runs by itself on game time.

const SHEETS = { plate18: [24, 24], plate14: [24, 12], poly: [48, 24], tube2x1: [60, 2], tube1x1: [60, 1] };
const STEPS = [1, 0.1, 0.01, 0.001];

export class CncOp extends Op {
  enter() {
    const p = this.p, s = p.spec;
    this.sheet = SHEETS[p.mat] || [24, 24];
    this.n = this.ctx.n;
    // Nest the pieces in rows from the corner.
    const pw = s.w || s.len, ph = s.h || (p.mat === 'tube1x1' ? 1 : 2);
    this.rects = [];
    let x = 0.6, y = 0.6;
    for (let i = 0; i < this.n; i++) {
      if (x + pw > this.sheet[0] - 0.3) { x = 0.6; y += ph + 0.4; }
      this.rects.push([x, y, pw, ph]);
      x += pw + 0.4;
    }
    this.fits = this.rects.every(([, yy, , hh]) => yy + hh <= this.sheet[1] - 0.3);
    this.clamps = [];
    this.stage = 0;
    this.pos = [this.sheet[0] * 0.5 + 3.3, -2.7];   // spindle X/Y in sheet coords, in
    this.zero = null;
    this.gap = 0.6;                                 // tool tip above the sheet, in
    this.zgap = null;
    this.si = 1;
    this.rpm = 18000; this.feed = 900;
    this.cv = overlayCanvas(this.ctx.hud);
    this.cv.c.addEventListener('pointerdown', (e) => this.click(e));
    this.render();
    this.cam([0, 2.1, 0.75], [0, 0.82, 0]);
  }

  render() {
    const chip = this.feed / this.rpm;
    this.panel({
      title: `CNC · ${this.p.name} ×${this.n}`,
      info: `${MATERIALS[this.p.mat].name}${this.fits ? '' : '（一張放不下，會用到第二張）'}`,
      steps: ['放夾具：點板材邊緣放 4 個以上，不要壓到刀具路徑（虛線）', 'XY 歸零：用尋邊器找板材左下角，按 Z 設零點', 'Z 對刀：慢慢降到紙張「微微拖動」，按 Z 設零點', '設定轉速與進給，按開始'],
      hint: ['點擊板材邊緣放夾具，再點一次移除 · Enter 下一步', '方向鍵移動主軸 · Q 切換步距 · Z 設 XY 零點', '↑／↓ 升降主軸 · Q 切換步距 · Z 設 Z 零點', '調整滑桿，按「開始加工」'][this.stage],
      read: this.stage === 3 ? `<label>主軸轉速 <b>${this.rpm}</b> RPM<input type="range" min="8000" max="24000" step="500" value="${this.rpm}" data-k="rpm"></label>
        <label>進給 <b>${this.feed}</b> mm/min<input type="range" min="200" max="3000" step="50" value="${this.feed}" data-k="feed"></label>
        <p>每刃進給量（1 刃）：<b class="${chip >= 0.04 && chip <= 0.08 ? 'ok' : 'bad'}">${chip.toFixed(3)} mm</b><br><small>鋁和 PC 板建議 0.04–0.08 mm</small></p>
        <button class="primary" data-k="go">開始加工</button>` : '',
    });
    this.step = this.stage;
    if (this.stage === 3) {
      for (const el of this.ui.querySelectorAll('input[data-k]')) el.oninput = () => { this[el.dataset.k] = +el.value; this.render(); };
      this.ui.querySelector('[data-k=go]').onclick = () => this.go();
    }
    this.draw();
  }

  // Sheet -> canvas transform.
  view() {
    const c = this.cv.c, W = c.width, H = c.height, pad = 80 * devicePixelRatio;
    const s = Math.min((W * 0.62 - pad) / (this.sheet[0] + 8), (H - pad * 2) / (this.sheet[1] + 8));
    const ox = pad + 3 * s, oy = H - pad - 3 * s;
    return { s, X: (x) => ox + x * s, Y: (y) => oy - y * s, ix: (px) => (px - ox) / s, iy: (py) => (oy - py) / s };
  }

  draw() {
    const { c, x } = this.cv, v = this.view(), d = devicePixelRatio;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(10,12,16,.82)'; x.fillRect(0, 0, c.width * 0.66, c.height);
    // Bed and sheet.
    x.fillStyle = '#6b5638'; x.fillRect(v.X(-3), v.Y(this.sheet[1] + 3), (this.sheet[0] + 6) * v.s, (this.sheet[1] + 6) * v.s);
    x.fillStyle = this.p.mat === 'poly' ? '#c7dcf0' : '#c4cad1'; x.fillRect(v.X(0), v.Y(this.sheet[1]), this.sheet[0] * v.s, this.sheet[1] * v.s);
    // Tool paths.
    x.setLineDash([6 * d, 4 * d]); x.strokeStyle = '#1b6fd8'; x.lineWidth = 1.5 * d;
    for (const [rx, ry, rw, rh] of this.rects) x.strokeRect(v.X(rx), v.Y(ry + rh), rw * v.s, rh * v.s);
    x.setLineDash([]);
    // Clamps.
    for (const k of this.clamps) {
      x.fillStyle = this.hitsPath(k) ? '#ef4444' : '#f59f00';
      x.fillRect(v.X(k[0] - 0.75), v.Y(k[1] + 0.5), 1.5 * v.s, 1 * v.s);
    }
    // Spindle.
    if (this.stage >= 1) {
      const px = v.X(this.pos[0]), py = v.Y(this.pos[1]);
      x.strokeStyle = '#ff3b3b'; x.lineWidth = 1.5 * d;
      x.beginPath(); x.moveTo(px - 14 * d, py); x.lineTo(px + 14 * d, py); x.moveTo(px, py - 14 * d); x.lineTo(px, py + 14 * d); x.stroke();
      x.beginPath(); x.arc(px, py, 5 * d, 0, Math.PI * 2); x.stroke();
    }
    if (this.zero) { x.fillStyle = '#22c55e'; x.beginPath(); x.arc(v.X(this.zero[0]), v.Y(this.zero[1]), 4 * d, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#fff'; x.font = `${13 * d}px system-ui`;
    if (this.stage === 1) {
      const ex = Math.abs(this.pos[0]) <= 0.004 && this.pos[1] > -1 && this.pos[1] < this.sheet[1];
      const ey = Math.abs(this.pos[1]) <= 0.004 && this.pos[0] > -1 && this.pos[0] < this.sheet[0];
      x.fillText(`步距 ${STEPS[this.si]} in`, 20 * d, 30 * d);
      x.fillStyle = ex ? '#22c55e' : '#555'; x.beginPath(); x.arc(30 * d, 56 * d, 8 * d, 0, 7); x.fill();
      x.fillStyle = ey ? '#22c55e' : '#555'; x.beginPath(); x.arc(30 * d, 80 * d, 8 * d, 0, 7); x.fill();
      x.fillStyle = '#fff'; x.fillText('尋邊器：碰到 X 邊（左緣）', 46 * d, 61 * d); x.fillText('尋邊器：碰到 Y 邊（下緣）', 46 * d, 85 * d);
    }
    if (this.stage === 2) {
      // Side view of the tool over the sheet.
      const bx = c.width * 0.66 - 230 * d, by = 120 * d;
      x.fillStyle = '#1b1f27'; x.fillRect(bx, by - 90 * d, 210 * d, 150 * d);
      x.fillStyle = '#c4cad1'; x.fillRect(bx + 10 * d, by + 20 * d, 190 * d, 14 * d);
      const tipY = by + 20 * d - Math.min(80 * d, Math.max(-6 * d, this.gap * 600 * d));
      x.fillStyle = '#ddd'; x.fillRect(bx + 100 * d, tipY - 70 * d, 10 * d, 70 * d);
      const feel = this.gap > 0.006 ? '紙張：自由滑動' : this.gap >= 0.002 ? '紙張：微微拖動 ✓' : this.gap > -0.002 ? '紙張：卡住拉不動' : '刀尖壓進板材！';
      x.fillStyle = this.gap > 0.006 ? '#aaa' : this.gap >= 0.002 ? '#22c55e' : '#ef4444';
      x.fillText(feel, bx + 10 * d, by + 54 * d);
      x.fillStyle = '#fff'; x.fillText(`步距 ${STEPS[this.si]} in`, bx + 10 * d, by - 72 * d);
    }
  }

  hitsPath([cx, cy]) {
    return this.rects.some(([rx, ry, rw, rh]) => cx + 0.75 > rx - 0.2 && cx - 0.75 < rx + rw + 0.2 && cy + 0.5 > ry - 0.2 && cy - 0.5 < ry + rh + 0.2);
  }

  click(e) {
    if (this.stage !== 0) return;
    const v = this.view(), r = this.cv.c.getBoundingClientRect(), d = devicePixelRatio;
    const sx = v.ix((e.clientX - r.left) * d), sy = v.iy((e.clientY - r.top) * d);
    const hit = this.clamps.findIndex(([x, y]) => Math.abs(x - sx) < 1 && Math.abs(y - sy) < 0.8);
    if (hit >= 0) { this.clamps.splice(hit, 1); this.draw(); return; }
    if (sx < -2 || sy < -2 || sx > this.sheet[0] + 2 || sy > this.sheet[1] + 2) return;
    // Snap to the nearest edge.
    const opts = [[clamp(sx, 0.75, this.sheet[0] - 0.75), 0.3, Math.abs(sy)], [clamp(sx, 0.75, this.sheet[0] - 0.75), this.sheet[1] - 0.3, Math.abs(sy - this.sheet[1])],
      [0.6, clamp(sy, 0.5, this.sheet[1] - 0.5), Math.abs(sx)], [this.sheet[0] - 0.6, clamp(sy, 0.5, this.sheet[1] - 0.5), Math.abs(sx - this.sheet[0])]];
    opts.sort((a, b) => a[2] - b[2]);
    this.clamps.push([opts[0][0], opts[0][1]]);
    this.draw();
  }

  key(code, down) {
    super.key(code, down);
    if (!down) return;
    if (code === 'KeyQ') { this.si = (this.si + 1) % STEPS.length; this.draw(); }
    if (this.stage === 0 && code === 'Enter') {
      if (this.clamps.length < 4) { this.msg('至少放 4 個夾具', 'bad'); return; }
      this.stage = 1; this.render();
    } else if (this.stage === 1) {
      const s = STEPS[this.si];
      if (code === 'ArrowLeft') this.pos[0] -= s; if (code === 'ArrowRight') this.pos[0] += s;
      if (code === 'ArrowUp') this.pos[1] += s; if (code === 'ArrowDown') this.pos[1] -= s;
      if (code === 'KeyZ') { this.zero = [...this.pos]; this.stage = 2; this.si = 1; this.msg('XY 零點已設定'); this.render(); return; }
      this.draw();
    } else if (this.stage === 2) {
      const s = STEPS[this.si];
      if (code === 'ArrowUp') this.gap += s;
      if (code === 'ArrowDown') {
        this.gap -= s;
        if (this.gap < -0.003) { this.ctx.breakTool('cnc'); this.gap = 0.1; this.msg('刀尖撞進板材，端銑刀斷了！', 'bad'); if (this.g.tools.endmill <= 0) { setTimeout(() => this.ctx.cancel(), 1200); } }
      }
      if (code === 'KeyZ') { this.zgap = this.gap; this.stage = 3; this.msg('Z 零點已設定'); this.render(); return; }
      this.draw();
    }
  }

  go() {
    const ex = Math.hypot(this.zero[0], this.zero[1]);
    const ez = this.zgap - 0.004;
    const chip = this.feed / this.rpm;
    const crash = this.clamps.some((k) => this.hitsPath(k));
    const sides = new Set(this.clamps.map(([x, y]) => (y < 1 ? 'b' : y > this.sheet[1] - 1 ? 't' : x < 1 ? 'l' : 'r')));
    if (crash) {
      this.ctx.breakTool('cnc');
      this.finish(0.15, '刀具撞上夾具，整張報廢、端銑刀斷了');
      return;
    }
    let q = 1 - ex * 4 - Math.max(0, Math.abs(ez) - 0.002) * 12;
    if (chip < 0.04) q -= 0.12 + (0.04 - chip) * 3;
    if (chip > 0.08) { q -= 0.1; if (Math.random() < (chip - 0.08) * 12) { this.ctx.breakTool('cnc'); q -= 0.25; } }
    if (sides.size < 3) q -= 0.15;
    if (ez > 0.02) q -= 0.2;   // didn't cut through: lots of cleanup
    this.finish(clamp(q, 0, 1), `XY 誤差 ${ex.toFixed(3)} in、Z 誤差 ${ez.toFixed(3)} in、每刃 ${chip.toFixed(3)} mm`);
  }

  wheel() {}
}
