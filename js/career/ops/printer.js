import { Op, clamp, overlayCanvas } from './base.js';

// 3D printer: slice the part (infill, layer height, walls), level the bed corner by corner with
// the paper test, then start the print. The printer runs by itself; a badly levelled bed warps.

const CORNERS = ['左前', '右前', '右後', '左後'];

export class PrinterOp extends Op {
  enter() {
    this.infill = 30; this.layer = 0.2; this.walls = 3;
    this.gaps = CORNERS.map(() => +(Math.random() * 0.4 - 0.15).toFixed(2));   // mm, ideal 0.1
    this.sel = 0;
    this.stage = 0;
    this.cv = overlayCanvas(this.ctx.hud);
    this.render();
    this.cam([0.0, 1.2, 0.7], [0, 0.85, 0]);
  }

  est() {
    const h = this.p.spec.hours * (0.6 + this.infill / 100 * 0.8) * (0.2 / this.layer) ** 0.85 * (0.8 + this.walls * 0.07);
    const strength = clamp(0.35 + this.infill / 100 * 0.45 + (this.walls - 2) * 0.06 + (0.28 - this.layer) * 0.4, 0, 1);
    return { h, strength };
  }

  render() {
    const { h, strength } = this.est();
    this.panel({
      title: `3D 印表機 · ${this.p.name}`,
      info: `PETG · 約 ${this.p.spec.grams} g`,
      steps: ['切片：設定填充率、層高、外牆圈數', '調平熱床：四個角都調到紙張「微微拖動」', '開始列印'],
      hint: this.stage === 0 ? '調整滑桿，按「下一步」' : this.stage === 1 ? '1–4 選角落 · ↑／↓ 轉調平旋鈕 · Enter 開始列印' : '',
      read: this.stage === 0 ? `<label>填充率 <b>${this.infill}%</b><input type="range" min="10" max="100" step="5" value="${this.infill}" data-k="infill"></label>
        <label>層高 <b>${this.layer} mm</b><input type="range" min="0.12" max="0.28" step="0.04" value="${this.layer}" data-k="layer"></label>
        <label>外牆 <b>${this.walls} 圈</b><input type="range" min="2" max="5" step="1" value="${this.walls}" data-k="walls"></label>
        <p>預估 <b>${h.toFixed(1)} 小時</b> · 強度 <b class="${strength > 0.6 ? 'ok' : 'bad'}">${Math.round(strength * 100)}%</b></p><button class="primary" data-k="next">下一步</button>`
        : `<p>選到：<b>${CORNERS[this.sel]}</b></p>${this.gaps.map((g, i) => `<div>${CORNERS[i]}：${this.feel(g)}</div>`).join('')}<button class="primary" data-k="go">開始列印</button>`,
    });
    this.step = this.stage;
    for (const el of this.ui.querySelectorAll('input[data-k]')) el.oninput = () => { this[el.dataset.k] = +el.value; this.render(); };
    const nx = this.ui.querySelector('[data-k=next]');
    if (nx) nx.onclick = () => { this.stage = 1; this.render(); };
    const go = this.ui.querySelector('[data-k=go]');
    if (go) go.onclick = () => this.go();
    this.draw();
  }

  feel(g) { return g > 0.16 ? '<span class="muted">太鬆（紙張自由滑動）</span>' : g >= 0.06 ? '<b class="ok">微微拖動 ✓</b>' : g >= -0.02 ? '<b class="bad">卡住（太緊）</b>' : '<b class="bad">噴頭刮到熱床！</b>'; }

  draw() {
    const { c, x } = this.cv, d = devicePixelRatio;
    x.clearRect(0, 0, c.width, c.height);
    if (this.stage !== 1) return;
    const cx = c.width * 0.33, cy = c.height * 0.5, s = Math.min(c.width, c.height) * 0.28;
    x.fillStyle = 'rgba(10,12,16,.7)'; x.fillRect(cx - s - 40 * d, cy - s - 40 * d, 2 * s + 80 * d, 2 * s + 80 * d);
    x.fillStyle = '#20232a'; x.fillRect(cx - s, cy - s, 2 * s, 2 * s);
    const pos = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    pos.forEach(([px, py], i) => {
      const X = cx + px * s * 0.85, Y = cy + py * s * 0.85, g = this.gaps[i];
      x.fillStyle = i === this.sel ? '#4b8bff' : '#555';
      x.beginPath(); x.arc(X, Y, 22 * d, 0, 7); x.fill();
      x.fillStyle = g >= 0.06 && g <= 0.16 ? '#22c55e' : '#ef4444';
      x.beginPath(); x.arc(X, Y, 8 * d, 0, 7); x.fill();
      x.fillStyle = '#fff'; x.font = `${13 * d}px system-ui`; x.textAlign = 'center';
      x.fillText(`${i + 1} ${CORNERS[i]}`, X, Y + 40 * d);
    });
  }

  key(code, down) {
    super.key(code, down);
    if (!down || this.stage !== 1) return;
    const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
    if (i >= 0) this.sel = i;
    if (code === 'ArrowUp') this.gaps[this.sel] = +(this.gaps[this.sel] + 0.02).toFixed(2);
    if (code === 'ArrowDown') this.gaps[this.sel] = +(this.gaps[this.sel] - 0.02).toFixed(2);
    if (code === 'Enter') { this.go(); return; }
    this.render();
  }
  wheel() {}

  go() {
    const { h, strength } = this.est();
    const lev = Math.max(...this.gaps.map((g) => Math.abs(g - 0.11)));
    let q = 0.5 + strength * 0.35 + clamp(0.15 - lev * 1.2, -0.5, 0.15);
    if (this.gaps.some((g) => g < -0.02)) q -= 0.3;   // nozzle drags on the bed
    this.ctx.minutes = Math.round(h * 60);
    this.finish(clamp(q, 0, 1), `強度 ${Math.round(strength * 100)}%、調平誤差 ${lev.toFixed(2)} mm、約 ${h.toFixed(1)} 小時`);
  }
}
