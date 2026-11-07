import * as THREE from './three.js';
import { FIELD_L, FIELD_W, HL, HW, HUB_X, HUB_HALF, BUMP, TRENCH, TOWER, DEPOT, OUTPOST, ZONE_X, COLORS, ROBOT_PRESETS } from './config.js';
import { buildField } from './field.js';
import { createWorld, stepWorld } from './sim.js';
import { STEP_TYPES, HEADINGS, START_X, newStep, newRoutine, loadAutos, saveAutos, packRoutine } from './auto.js';

// AUTO routine editor: a top-down field where you draw paths, a list of steps, and a preview that
// runs the 20 s AUTO headless and plays it back on the field drawing.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const M = 0.35;                       // margin around the field drawing, metres
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const PATH_COLORS = ['#f6d31c', '#4ade80', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa'];
const deg = (h) => Math.round(((h * 180 / Math.PI) % 360 + 360) % 360);

export class AutoEditor {
  // robot(): the preset key in use; customs(): builder robots; onUse(id) / onClose().
  constructor({ robot, team, customs, onUse, onClose }) {
    Object.assign(this, { robot, team, customs, onUse, onClose });
    this.routine = null;
    this.sel = -1;
    this.drag = null;
    this.preview = null;
    const root = $('autoedit');
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('input', (e) => this.input(e));
    root.addEventListener('change', (e) => this.change(e));
    const cv = $('ae-canvas');
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.addEventListener('pointermove', (e) => this.move(e));
    cv.addEventListener('pointerup', () => { this.drag = null; });
    cv.addEventListener('pointercancel', () => { this.drag = null; });
    cv.addEventListener('dblclick', (e) => this.remove(e));
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); this.remove(e); });
    addEventListener('resize', () => { if (this.open) this.draw(); });
  }

  get open() { return !$('autoedit').hidden; }
  get p() { return ROBOT_PRESETS[this.robot()] || ROBOT_PRESETS.balanced; }

  show(id) {
    const list = loadAutos();
    const cur = list.find((r) => r.id === id) || list[0];
    this.routine = cur ? structuredClone(cur) : newRoutine();
    this.sel = this.routine.steps.findIndex((s) => s.type === 'path');
    this.preview = null;
    $('autoedit').hidden = false;
    this.render();
  }

  hide() { this.stop(); $('autoedit').hidden = true; }

  // ---------- Panel ----------
  render() {
    const list = loadAutos(), R = this.routine;
    const saved = list.some((x) => x.id === R.id);
    $('ae-list').innerHTML = `<select id="ae-pick">${list.map((x) => `<option value="${x.id}"${x.id === R.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}${saved ? '' : `<option value="${R.id}" selected>（新的）${esc(R.name)}</option>`}</select>
      <button data-act="new">新增</button><button data-act="copy">複製</button><button data-act="mirror" title="上下翻轉（換到另一側的起點）">左右翻轉</button>${saved ? '<button data-act="delete">刪除</button>' : ''}`;
    const steps = R.steps.map((st, i) => this.stepCard(st, i)).join('');
    $('ae-side').innerHTML = `
      <div class="grid">
        <label>名稱<input id="ae-name" type="text" maxlength="32" value="${esc(R.name)}"></label>
        <label>起點朝向 <b data-show="h">${deg(R.start.h)}°</b><input type="range" data-start="h" min="0" max="345" step="15" value="${deg(R.start.h)}"></label>
      </div>
      <p class="muted">拖曳場上的機器人改變起點（只能沿著起始線移動）。選取一個路徑步驟後，點場地加路徑點，拖曳移動，雙擊或右鍵刪除；點在路徑線上會插入新點。</p>
      <div class="ae-steps">${steps || '<p class="muted">還沒有步驟，從下面加一個。</p>'}</div>
      <div class="ae-add">${Object.entries(STEP_TYPES).map(([k, n]) => `<button data-act="add" data-type="${k}">＋ ${n}</button>`).join('')}</div>
      <div id="ae-result" class="ae-result">${this.resultHtml()}</div>`;
    this.draw();
  }

  stepCard(st, i) {
    const on = i === this.sel ? ' on' : '';
    const color = st.type === 'path' ? PATH_COLORS[this.pathIndex(i) % PATH_COLORS.length] : '#8b94a3';
    const t0 = this.preview?.stepStart?.[i];
    const when = t0 !== undefined ? `<small class="ae-when">${t0.toFixed(1)} s</small>` : this.preview ? '<small class="ae-when late">沒跑到</small>' : '';
    const tools = `<span class="ae-tools"><button data-act="up" data-i="${i}" title="上移">↑</button><button data-act="down" data-i="${i}" title="下移">↓</button><button data-act="del" data-i="${i}" title="刪除">✕</button></span>`;
    let body = '';
    if (st.type === 'path') {
      const warn = this.warnings(i).map((w) => `<li>${w}</li>`).join('');
      body = `<div class="grid">
          <label>速度 <b data-show="speed${i}">${Math.round(st.speed * 100)}%</b><input type="range" data-i="${i}" data-k="speed" min="0.2" max="1" step="0.05" value="${st.speed}"></label>
          <label>車頭<select data-i="${i}" data-k="heading">${Object.entries(HEADINGS).map(([k, n]) => `<option value="${k}"${st.heading === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <div class="ae-checks"><label><input type="checkbox" data-i="${i}" data-k="intake"${st.intake ? ' checked' : ''}> 開 intake</label>
          <label><input type="checkbox" data-i="${i}" data-k="shoot"${st.shoot ? ' checked' : ''}> 在己方區域時邊走邊射</label>
          <span class="muted">${st.pts.length} 個點 · ${this.length(i).toFixed(1)} m</span></div>
        ${warn ? `<ul class="b-err">${warn}</ul>` : ''}`;
    } else if (st.type === 'shoot' || st.type === 'intake' || st.type === 'wait') {
      const label = st.type === 'shoot' ? '最多射' : '持續';
      body = `<label class="ae-time">${label} <b data-show="time${i}">${st.time} s</b><input type="range" data-i="${i}" data-k="time" min="0.5" max="15" step="0.5" value="${st.time}"></label>
        ${st.type === 'shoot' ? '<span class="muted">停下來射到空為止（固定式射手會自己轉車頭）</span>' : ''}`;
    } else if (st.type === 'climb') {
      body = `<span class="muted">${this.p.climbMax ? '開到己方 TOWER 爬 L1（AUTO 結束時掛著 = 15 分）' : '這台機器人不能爬'}</span>`;
    }
    return `<div class="ae-step${on}" data-act="select" data-i="${i}" style="--c:${color}">
      <div class="ae-step-head"><b>${i + 1}. ${STEP_TYPES[st.type]}</b>${when}${tools}</div>${body}</div>`;
  }

  resultHtml() {
    const P = this.preview;
    if (!P) return '<button class="primary" data-act="preview">預覽 AUTO</button> <label class="ae-bots"><input type="checkbox" id="ae-bots"> 加入其他 5 台電腦機器人</label>';
    const r = P.res;
    return `<div class="ae-play"><button data-act="play">${this.playing ? '暫停' : '播放'}</button><input type="range" id="ae-time" min="0" max="${P.frames.length - 1}" value="${P.f}"><span id="ae-clock">${(P.f / P.hz).toFixed(1)} s</span></div>
      <p><b>AUTO 得分 ${r.fuel + r.tower}</b>（你的機器人進 ${r.scored} 球 / 射 ${r.shots} 球${r.tower ? `、TOWER L1 ${r.tower} 分` : ''}）· 聯盟 AUTO FUEL ${r.allianceFuel} · 吸入 ${r.intaked} 球 · 結束時剩 ${r.left} 球</p>
      <p class="muted">${r.done ? `全部步驟在 ${r.doneAt.toFixed(1)} 秒跑完。` : `AUTO 結束時停在：${esc(r.at)}。`}${P.bots ? '有其他機器人，路線可能被擋。' : ''}</p>
      <button data-act="preview">重新預覽</button> <label class="ae-bots"><input type="checkbox" id="ae-bots"${P.bots ? ' checked' : ''}> 加入其他 5 台電腦機器人</label>`;
  }

  // ---------- Geometry helpers ----------
  pathIndex(i) { return this.routine.steps.slice(0, i).filter((s) => s.type === 'path').length; }

  // Where the robot is (planned) when step i starts.
  fromOf(i) {
    const R = this.routine;
    let pos = [START_X, R.start.z];
    for (let k = 0; k < i; k++) {
      const st = R.steps[k];
      if (st.type === 'path' && st.pts.length) pos = st.pts[st.pts.length - 1];
      if (st.type === 'climb') pos = [-(TOWER.x - 0.47), -TOWER.z];
    }
    return pos;
  }

  length(i) {
    const pts = [this.fromOf(i), ...this.routine.steps[i].pts];
    let d = 0;
    for (let k = 1; k < pts.length; k++) d += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    return d;
  }

  warnings(i) {
    const st = this.routine.steps[i], p = this.p;
    const pts = [this.fromOf(i), ...st.pts], rr = Math.max(p.halfL, p.halfW);
    const out = new Set();
    for (let k = 1; k < pts.length; k++) {
      const [x0, z0] = pts[k - 1], [x1, z1] = pts[k], n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.1);
      for (let j = 0; j <= n; j++) {
        const x = x0 + (x1 - x0) * j / n, z = z0 + (z1 - z0) * j / n;
        if (Math.abs(Math.abs(x) - HUB_X) < HUB_HALF + rr * 0.6 && Math.abs(z) < HUB_HALF + rr * 0.6) out.add('路徑撞到 HUB');
        if (!p.fitsTrench && Math.abs(Math.abs(x) - HUB_X) < BUMP.depth / 2 + rr * 0.5 && Math.abs(z) > TRENCH.zMin + 0.1) out.add('這台機器人太高，鑽不過 TRENCH');
        if (x - p.halfL > 0) out.add('整台車越過中線（規則上 AUTO 不能完全越過）');
      }
    }
    return [...out];
  }

  // ---------- Field drawing ----------
  frame() {
    const cv = $('ae-canvas'), w = cv.clientWidth, dpr = Math.min(devicePixelRatio, 2);
    const h = Math.round(w * (FIELD_W + 2 * M) / (FIELD_L + 2 * M));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = `${h}px`; }
    const k = w / (FIELD_L + 2 * M);
    return { cv, ctx: cv.getContext('2d'), dpr, k, X: (x) => (x + HL + M) * k, Z: (z) => (z + HW + M) * k };
  }

  toField(e) {
    const r = $('ae-canvas').getBoundingClientRect(), k = r.width / (FIELD_L + 2 * M);
    return [(e.clientX - r.left) / k - HL - M, (e.clientY - r.top) / k - HW - M];
  }

  draw() {
    if (!this.open || !this.routine) return;
    const { ctx, dpr, k, X, Z } = this.frame();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = X(HL + M), H = Z(HW + M);
    ctx.fillStyle = '#15181d'; ctx.fillRect(0, 0, W, H);
    const rect = (x0, z0, x1, z1, fill, stroke) => {
      const a = X(Math.min(x0, x1)), b = Z(Math.min(z0, z1)), c = Math.abs(x1 - x0) * k, d = Math.abs(z1 - z0) * k;
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(a, b, c, d); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, b + 0.5, c, d); }
    };
    rect(-HL, -HW, HL, HW, '#3b3f46');
    // Alliance zones, BUMPs, TRENCHes, HUBs, TOWERs, DEPOTs, OUTPOST openings.
    for (const s of [-1, 1]) {
      const col = hex(s > 0 ? COLORS.red : COLORS.blue);
      rect(s * ZONE_X, -HW, s * HL, HW, s > 0 ? 'rgba(229,48,59,.12)' : 'rgba(47,111,228,.14)');
      rect(s * (HUB_X - BUMP.depth / 2), -BUMP.zMax, s * (HUB_X + BUMP.depth / 2), -BUMP.zMin, '#55606e');
      rect(s * (HUB_X - BUMP.depth / 2), BUMP.zMin, s * (HUB_X + BUMP.depth / 2), BUMP.zMax, '#55606e');
      for (const zs of [-1, 1]) rect(s * (HUB_X - BUMP.depth / 2), zs * TRENCH.zMin, s * (HUB_X + BUMP.depth / 2), zs * HW, 'rgba(10,12,16,.55)', '#262a31');
      rect(s * (HUB_X - HUB_HALF), -HUB_HALF, s * (HUB_X + HUB_HALF), HUB_HALF, '#2c3038', col);
      rect(s * HL, s * (TOWER.z - TOWER.rungHalf), s * (TOWER.x - 0.05), s * (TOWER.z + TOWER.rungHalf), '#2a2d33', col);
      rect(s * DEPOT.x0, s * DEPOT.z0, s * DEPOT.x1, s * DEPOT.z1, null, col);
      rect(s * HL, s * (OUTPOST.z - OUTPOST.halfW), s * (HL + 0.12), s * (OUTPOST.z + OUTPOST.halfW), col);
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(s * (HUB_X + BUMP.depth / 2)), Z(-HW)); ctx.lineTo(X(s * (HUB_X + BUMP.depth / 2)), Z(HW)); ctx.stroke();
    }
    ctx.strokeStyle = '#d8dde6'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(0), Z(-HW)); ctx.lineTo(X(0), Z(HW)); ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.moveTo(X(START_X), Z(-HW)); ctx.lineTo(X(START_X), Z(HW)); ctx.stroke();
    ctx.setLineDash([]);
    rect(-0.88, -2.25, 0.88, 2.25, 'rgba(246,211,28,.13)', 'rgba(246,211,28,.35)');
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('藍聯盟（紅聯盟自動鏡像）', X(-HL) + 6, Z(-HW) + 14);

    const P = this.preview;
    if (P) this.drawPreview(ctx, X, Z, k);
    else this.drawPlan(ctx, X, Z, k);
  }

  drawPlan(ctx, X, Z, k) {
    const R = this.routine;
    R.steps.forEach((st, i) => {
      if (st.type !== 'path') return;
      const color = PATH_COLORS[this.pathIndex(i) % PATH_COLORS.length], on = i === this.sel;
      const pts = [this.fromOf(i), ...st.pts];
      ctx.strokeStyle = color; ctx.globalAlpha = on ? 1 : 0.55; ctx.lineWidth = on ? 3 : 2;
      ctx.beginPath();
      splineDraw(pts).forEach(([x, z], j) => (j ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
      st.pts.forEach(([x, z], j) => {
        ctx.fillStyle = on ? color : '#15181d'; ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(x), Z(z), on ? 7 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (on) { ctx.fillStyle = '#111'; ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(j + 1), X(x), Z(z) + 3); ctx.textAlign = 'left'; }
      });
      ctx.globalAlpha = 1;
    });
    // Markers for the steps that happen in place.
    R.steps.forEach((st, i) => {
      if (st.type === 'path') return;
      const [x, z] = st.type === 'climb' ? [-(TOWER.x - 0.47), -TOWER.z] : this.fromOf(i);
      ctx.fillStyle = i === this.sel ? '#fff' : 'rgba(255,255,255,.75)';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(`${i + 1}.${{ shoot: '射', intake: '吸', wait: '等', climb: '爬' }[st.type]}`, X(x) + 8, Z(z) - 8 - (i % 2) * 12);
    });
    const p = this.p;
    robotShape(ctx, X(START_X), Z(R.start.z), R.start.h, p.halfL * k, p.halfW * k, p.shape === 'round', hex(COLORS.blue), true);
  }

  drawPreview(ctx, X, Z, k) {
    const P = this.preview, fr = P.frames[P.f];
    // Our planned paths faintly, then the trail the robot actually drove.
    ctx.globalAlpha = 0.25; this.drawPlanLines(ctx, X, Z); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let j = 0; j <= P.f; j++) { const r = P.frames[j].robots[0]; j ? ctx.lineTo(X(r[0]), Z(r[1])) : ctx.moveTo(X(r[0]), Z(r[1])); }
    ctx.stroke();
    ctx.fillStyle = '#f6d31c';
    const f = fr.fuel;
    for (let j = 0; j < f.length; j += 2) ctx.fillRect(X(f[j]) - 1.5, Z(f[j + 1]) - 1.5, 3, 3);
    fr.robots.forEach((r, i) => {
      const info = P.robots[i];
      robotShape(ctx, X(r[0]), Z(r[1]), r[2], info.halfL * k, info.halfW * k, info.round, hex(COLORS[info.alliance]), i === 0);
    });
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(`${(P.f / P.hz).toFixed(1)} s · ${fr.label}`, X(-HL) + 6, Z(HW) - 8);
  }

  drawPlanLines(ctx, X, Z) {
    this.routine.steps.forEach((st, i) => {
      if (st.type !== 'path') return;
      ctx.strokeStyle = PATH_COLORS[this.pathIndex(i) % PATH_COLORS.length]; ctx.lineWidth = 3;
      ctx.beginPath();
      splineDraw([this.fromOf(i), ...st.pts]).forEach(([x, z], j) => (j ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
    });
  }

  // ---------- Pointer editing ----------
  hit(e) {
    const [x, z] = this.toField(e), r = $('ae-canvas').getBoundingClientRect(), k = r.width / (FIELD_L + 2 * M);
    const near = (px, pz, rad) => Math.hypot(px - x, pz - z) * k < rad;
    const R = this.routine;
    const order = [this.sel, ...R.steps.map((_, i) => i).filter((i) => i !== this.sel)];
    for (const i of order) {
      const st = R.steps[i];
      if (st?.type !== 'path') continue;
      const j = st.pts.findIndex(([px, pz]) => near(px, pz, 11));
      if (j >= 0) return { kind: 'pt', i, j };
    }
    const p = this.p;
    if (Math.abs(x - START_X) < p.halfL + 0.1 && Math.abs(z - R.start.z) < p.halfW + 0.1) return { kind: 'start' };
    return { kind: 'field', x, z, k };
  }

  down(e) {
    if (this.preview) { this.preview = null; this.stop(); this.render(); }
    const h = this.hit(e), R = this.routine;
    $('ae-canvas').setPointerCapture(e.pointerId);
    if (h.kind === 'pt') { if (this.sel !== h.i) { this.sel = h.i; this.render(); } this.drag = h; return; }
    if (h.kind === 'start') { this.drag = h; return; }
    const st = R.steps[this.sel];
    if (st?.type !== 'path') return;
    // Click on the line between two points inserts there; anywhere else appends.
    const pts = [this.fromOf(this.sel), ...st.pts];
    let bestJ = -1, bestD = Infinity;
    for (let j = 1; j < pts.length; j++) {
      const d = segDist(h.x, h.z, pts[j - 1], pts[j]);
      if (d < bestD) { bestD = d; bestJ = j - 1; }
    }
    const p = clampPt([h.x, h.z]);
    if (bestD * h.k < 10) st.pts.splice(bestJ, 0, p); else st.pts.push(p);
    this.drag = { kind: 'pt', i: this.sel, j: bestD * h.k < 10 ? bestJ : st.pts.length - 1 };
    this.render();
  }

  move(e) {
    const d = this.drag;
    if (!d) { $('ae-canvas').style.cursor = this.hit(e).kind === 'field' ? (this.routine.steps[this.sel]?.type === 'path' ? 'crosshair' : 'default') : 'grab'; return; }
    const [x, z] = this.toField(e);
    if (d.kind === 'start') this.routine.start.z = Math.round(Math.max(-HW + this.p.halfW, Math.min(HW - this.p.halfW, z)) * 100) / 100;
    else this.routine.steps[d.i].pts[d.j] = clampPt([x, z]);
    this.draw();
    this.drag.moved = true;
    if (!this.queued) { this.queued = true; setTimeout(() => { this.queued = false; this.render(); }, 120); }
  }

  remove(e) {
    e.preventDefault();
    const h = this.hit(e);
    if (h.kind !== 'pt') return;
    const st = this.routine.steps[h.i];
    if (st.pts.length > 1) st.pts.splice(h.j, 1);
    this.render();
  }

  // ---------- Panel events ----------
  click(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act, R = this.routine, i = +el.dataset.i;
    if (act === 'select') { if (e.target.closest('input, select, label, button')) return; this.sel = i; this.render(); return; }
    e.stopPropagation();
    if (act === 'close') { this.hide(); this.onClose(); return; }
    if (act === 'add') {
      const at = this.sel >= 0 ? this.sel + 1 : R.steps.length;
      R.steps.splice(at, 0, newStep(el.dataset.type, this.fromOf(at)));
      this.sel = at;
    }
    if (act === 'up' && i > 0) { [R.steps[i - 1], R.steps[i]] = [R.steps[i], R.steps[i - 1]]; this.sel = i - 1; }
    if (act === 'down' && i < R.steps.length - 1) { [R.steps[i + 1], R.steps[i]] = [R.steps[i], R.steps[i + 1]]; this.sel = i + 1; }
    if (act === 'del') { R.steps.splice(i, 1); this.sel = Math.min(this.sel, R.steps.length - 1); }
    if (act === 'new') { this.routine = newRoutine(); this.routine.steps.push(newStep('path')); this.sel = 0; }
    if (act === 'copy') { this.routine = { ...structuredClone(R), id: Date.now().toString(36), name: `${R.name} 複本` }; }
    if (act === 'mirror') {
      R.start.z = -R.start.z; R.start.h = -R.start.h;
      for (const st of R.steps) if (st.pts) st.pts = st.pts.map(([x, z]) => [x, -z]);
    }
    if (act === 'delete') {
      if (!confirm(`刪除「${R.name}」？`)) return;
      saveAutos(loadAutos().filter((x) => x.id !== R.id));
      const list = loadAutos();
      this.routine = list[0] ? structuredClone(list[0]) : newRoutine();
      this.sel = -1;
    }
    if (act === 'save' || act === 'use') {
      R.name = R.name.trim() || '自動程式';
      const list = loadAutos(), k = list.findIndex((x) => x.id === R.id);
      if (k >= 0) list[k] = structuredClone(R); else list.push(structuredClone(R));
      saveAutos(list);
      if (act === 'use') { this.hide(); this.onUse(R.id); return; }
    }
    if (act === 'preview') { this.run($('ae-bots')?.checked); return; }
    if (act === 'play') { if (this.playing) this.stop(); else this.play(); this.render(); return; }
    if (act !== 'preview') this.preview = null;
    this.render();
  }

  input(e) {
    const t = e.target, R = this.routine;
    if (t.id === 'ae-name') { R.name = t.value; return; }
    if (t.id === 'ae-time') { this.stop(); this.preview.f = +t.value; $('ae-clock').textContent = `${(this.preview.f / this.preview.hz).toFixed(1)} s`; this.draw(); return; }
    if (t.dataset.start === 'h') { R.start.h = +t.value * Math.PI / 180; this.show1('h', `${t.value}°`); this.draw(); return; }
    if (t.type === 'range' && t.dataset.k) {
      const st = R.steps[+t.dataset.i];
      st[t.dataset.k] = +t.value;
      this.show1(t.dataset.k + t.dataset.i, t.dataset.k === 'speed' ? `${Math.round(t.value * 100)}%` : `${t.value} s`);
      this.preview = null;
    }
  }

  change(e) {
    const t = e.target, R = this.routine;
    if (t.id === 'ae-pick') {
      const x = loadAutos().find((y) => y.id === t.value);
      if (x) { this.routine = structuredClone(x); this.sel = this.routine.steps.findIndex((s) => s.type === 'path'); this.preview = null; }
      this.render();
      return;
    }
    if (t.dataset.k && t.type !== 'range') {
      const st = R.steps[+t.dataset.i];
      st[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.value;
      this.preview = null;
      this.render();
    }
  }

  show1(key, text) { const el = $('autoedit').querySelector(`[data-show="${key}"]`); if (el) el.textContent = text; }

  // ---------- Preview: run AUTO headless and record it ----------
  run(bots) {
    this.stop();
    if (!this.sim) { this.sim = { scene: new THREE.Scene() }; this.sim.field = buildField(this.sim.scene); }
    const { scene, field } = this.sim;
    const key = this.robot();
    const cfg = {
      mode: 'match', alliance: 'blue', preset: key, team: this.team(), solo: !bots,
      allySkill: 'hard', oppSkill: 'hard', allyTactic: 'balanced', oppTactic: 'balanced',
      allyBots: ['random', 'random'], oppBots: ['random', 'random', 'random'],
      autoRoutine: packRoutine(this.routine), customs: this.customs(),
    };
    const world = createWorld(scene, field, cfg, null);
    const m = world.match, me = world.player, runner = me.autoRunner;
    const hz = 20, per = Math.round(120 / hz), STEP = 1 / 120;
    const frames = [], stepStart = {};
    let doneAt = null, n = 0, climbed = 0;
    const end = m.autoEnd + 2.5;    // let the last shots land
    while (m.t < end) {
      if (m.phase === 'auto' && !runner.done && stepStart[runner.i] === undefined) stepStart[runner.i] = m.t - m.countdownEnd;
      if (m.phase === 'auto' && runner.done && doneAt === null) doneAt = m.t - m.countdownEnd;
      stepWorld(world, STEP, null);
      if (m.phase === 'auto') climbed = me.climbLevel;
      if (m.t >= m.countdownEnd && n++ % per === 0) {
        const fuel = [];
        for (let i = 0; i < world.fuel.n; i++) if (world.fuel.active[i]) fuel.push(world.fuel.px[i], world.fuel.pz[i]);
        frames.push({ robots: world.robots.map((r) => [r.x, r.z, r.h]), fuel: new Float32Array(fuel), label: m.phase === 'auto' ? runner.label : 'AUTO 結束' });
      }
    }
    const sc = m.score.blue;
    this.preview = {
      hz, f: 0, frames, stepStart, bots,
      robots: world.robots.map((r) => ({ alliance: r.alliance, halfL: r.p.halfL, halfW: r.p.halfW, round: r.p.shape === 'round' })),
      res: {
        fuel: me.stats.scored, tower: climbed ? 15 : 0, allianceFuel: sc.autoFuel, scored: me.stats.scored, shots: me.stats.shots,
        intaked: me.stats.intaked, left: me.fuel, done: doneAt !== null, doneAt, at: runner.label,
      },
    };
    for (const r of world.robots) scene.remove(r.mesh);
    scene.remove(world.fuel.mesh);
    world.fuel.mesh.geometry.dispose();
    this.render();
    this.play();
  }

  play() {
    const P = this.preview;
    if (!P) return;
    if (P.f >= P.frames.length - 1) P.f = 0;
    this.playing = true;
    let last = performance.now(), t = P.f / P.hz;
    // Plays back at 1.5x.
    const tick = (now) => {
      if (!this.playing || !this.open || this.preview !== P) { this.playing = false; return; }
      t += Math.min(0.1, (now - last) / 1000) * 1.5;
      last = now;
      P.f = Math.min(P.frames.length - 1, Math.floor(t * P.hz));
      const bar = $('ae-time');
      if (bar) { bar.value = P.f; $('ae-clock').textContent = `${(P.f / P.hz).toFixed(1)} s`; }
      this.draw();
      if (P.f >= P.frames.length - 1) { this.playing = false; this.render(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() { this.playing = false; }
}

// ---------- Drawing helpers ----------
function splineDraw(pts) {
  if (pts.length < 2) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 12; k++) {
      const t = k / 12, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function robotShape(ctx, x, y, h, hl, hw, round, color, me) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-h);
  ctx.fillStyle = color; ctx.globalAlpha = me ? 0.95 : 0.7;
  ctx.strokeStyle = me ? '#fff' : 'rgba(0,0,0,.5)'; ctx.lineWidth = me ? 2 : 1;
  ctx.beginPath();
  if (round) ctx.arc(0, 0, hl, 0, Math.PI * 2); else ctx.rect(-hl, -hw, hl * 2, hw * 2);
  ctx.fill(); ctx.stroke();
  // Nose marker.
  ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(hl, 0); ctx.lineTo(hl - Math.min(8, hl * 0.6), -Math.min(5, hw * 0.5)); ctx.lineTo(hl - Math.min(8, hl * 0.6), Math.min(5, hw * 0.5)); ctx.fill();
  ctx.restore();
}

const clampPt = ([x, z]) => [Math.round(Math.max(-HL + 0.4, Math.min(HL - 0.4, x)) * 100) / 100, Math.round(Math.max(-HW + 0.4, Math.min(HW - 0.4, z)) * 100) / 100];

function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
}
