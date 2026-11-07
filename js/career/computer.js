import { MANUAL } from './manual.js';
import { eventByKey, shortName } from '../season.js';
import { KIND, EXTRA_FEE, openRegionals, addRegional } from './compete.js';
import { MODES, HOTELS, SITES, tripTimes, travel, travelers, ticketPrice, hotelPrice, askTeam } from './trip.js';
import {
  VENDORS, MATERIALS, COTS, TOOLS, MACHINES, SUBS, SUB_ORDER, METHODS, KINDS, PROGRAM_HOURS, SHIPPING, SHOPS,
  money, fmtDate, fmtClock, outsourceCost, motorsFor, cotsFor, ROLES,
} from './data.js';
import {
  detailed, partQuality, unitsDone, partDone, opsOf, methodOk, outsource, canBuild, orderTotal, checkout, shortages, jobs,
  placedMachines, log, drivable, complete,
} from './state.js';

// The workshop computer: a little desktop with apps. Everything here runs on game time; the clock
// keeps going while you read and shop.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const bar = (x) => `<span class="pc-bar"><i style="width:${Math.min(100, x * 100)}%"></i></span>`;
const APPS = [['project', '專案'], ['manual', '規則手冊'], ['cad', 'CAD'], ['web', '瀏覽器'], ['mail', '信箱'], ['code', '程式'], ['crew', '隊員'], ['season', '賽程'], ['travel', '旅行'], ['orders', '訂單']];
const FINISH = { 1: '冠軍', 2: '亞軍', 3: '第 3 名', 4: '第 4 名', 5: '第 5–6 名', 7: '第 7–8 名' };
// You work faster than a student on design and code.
const PLAYER_RATE = 1.5;
const OPWORD = { band: '鋸切', drill: '鑽孔', bench: '去毛邊／攻牙', lathe: '車削', cnc: 'CNC', printer: '列印' };

export class Computer {
  // hooks: { g(), cad(), passTime(hours, why), toast(text), close(), changed() }
  constructor(hooks) {
    this.h = hooks;
    this.app = 'project';
    this.site = 'pacific';
    this.carts = {};
    this.mailId = null;
    this.chapter = 0;
    this.el = document.getElementById('pc');
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('change', (e) => this.change(e));
    this.el.addEventListener('input', (e) => this.input(e));
  }
  get g() { return this.h.g(); }
  get open() { return !this.el.hidden; }

  show(app) {
    if (app) this.app = app;
    this.el.hidden = false;
    this.render();
  }
  hide() { this.el.hidden = true; }

  render() {
    if (!this.open) return;
    const g = this.g, unread = g.mail.filter((m) => !m.read).length;
    const body = this[`app_${this.app}`]();
    this.el.innerHTML = `<div class="pc-screen">
      <div class="pc-top">
        <div class="pc-apps">${APPS.map(([k, n]) => `<button data-act="app" data-app="${k}" class="${k === this.app ? 'on' : ''}">${n}${k === 'mail' && unread ? ` <b class="pc-dot">${unread}</b>` : ''}</button>`).join('')}</div>
        <div class="pc-status"><span>${fmtDate(g.t)} ${fmtClock(g.t)}</span><span class="pc-money">${money(g.money)}</span><button data-act="close">離開電腦 (Esc)</button></div>
      </div>
      <div class="pc-body">${body}</div></div>`;
    if (this.app === 'code') this.plot();
  }
  // Refresh the clock line without re-rendering inputs.
  tick() {
    if (!this.open) return;
    const s = this.el.querySelector('.pc-status span');
    if (s) s.textContent = `${fmtDate(this.g.t)} ${fmtClock(this.g.t)}`;
    const m = this.el.querySelector('.pc-money');
    if (m) m.textContent = money(this.g.money);
  }

  // ---------- Project / BOM ----------
  app_project() {
    const g = this.g;
    if (!g.design) return `<div class="pc-empty"><h2>還沒有機器人設計</h2><p>打開 CAD 畫出今年的機器人：尺寸、驅動、intake、hopper、射球器和攀爬。存檔後會產生零件清單（BOM）。</p><button class="primary" data-act="app" data-app="cad">打開 CAD</button></div>`;
    const lack = shortages(g);
    const rows = SUB_ORDER.map((sub) => {
      const S = g.subs[sub], D = g.detail[sub];
      if (!S || S.skip) return '';
      const parts = Object.values(g.parts).filter((p) => p.sub === sub);
      const cb = canBuild(g, sub);
      const det = detailed(g, sub);
      return `<div class="pc-sub">
        <div class="pc-sub-head"><b>${SUBS[sub].name}</b>
          <span>${det ? '細部設計 ✓' : `細部設計 ${bar(D.done / Math.max(0.01, D.need))} ${D.done.toFixed(1)}/${D.need} h <button data-act="detail" data-sub="${sub}" data-h="2">自己做 2 小時</button><button data-act="detail" data-sub="${sub}">做到關門</button>`}</span>
          <span>${S.done ? `組裝完成 · 品質 ${pct(S.q)}` : cb.ok ? '<b class="ok">可以組裝（到推車）</b>' : `<small>${esc(cb.why || '')}</small>`}</span></div>
        ${parts.length ? `<table class="pc-table"><tr><th>零件</th><th>數量</th><th>做法</th><th>進度</th><th>品質</th><th></th></tr>
          ${parts.map((p) => {
    const made = unitsDone(p), ops = opsOf(p);
    const stage = ops.map((st, i) => `${OPWORD[st]} ${p.done[i] || 0}`).join(' → ');
    const methods = KINDS[p.kind].methods.map((m) => `<option value="${m}"${p.method === m ? ' selected' : ''}${m !== 'outsource' && !methodOk(g, m) ? ' disabled' : ''}>${METHODS[m].name}${m !== 'outsource' && !methodOk(g, m) ? '（缺機台）' : ''}</option>`).join('');
    const started = p.done.some(Boolean) || p.out;
    return `<tr class="${partDone(p) ? 'done' : ''}"><td>${esc(p.name)}<br><small>${KINDS[p.kind].name} · ${esc(MATERIALS[p.mat].name.split('（')[0])}</small></td><td>${made}/${p.qty}</td>
              <td>${started ? METHODS[p.method].name : `<select data-act="method" data-part="${p.id}">${methods}</select>`}</td>
              <td><small>${p.out ? (p.out.eta ? `外包中，${fmtDate(p.out.eta)} 到` : '外包完成') : ops.length ? stage : ''}</small></td>
              <td>${made ? pct(partQuality(p)) : ''}</td>
              <td>${!partDone(p) && !p.out && det ? `<button data-act="outsource" data-part="${p.id}">外包 ${money(outsourceCost(p) * (p.qty - made) / p.qty)}</button>` : ''}</td></tr>`;
  }).join('')}</table>` : ''}
        ${Object.keys(S.cots).length ? `<div class="pc-cots">COTS：${Object.entries(S.cots).map(([i, q]) => `<span class="${S.installed || (g.cots[i] || 0) >= q ? 'ok' : 'bad'}">${esc(COTS[i].name)} ${S.installed ? q : Math.min(q, g.cots[i] || 0)}/${q}</span>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
    const prog = g.program;
    return `<div class="pc-proj-head">
        <div><h2>${esc(g.design.name)} · 第 ${g.rev} 版</h2><p class="muted">在機台前按 E 就能做零件；零件做完、COTS 到齊後到推車組裝。</p></div>
        <div class="pc-proj-tools">${lack.length ? `<button class="primary" data-act="fillcart">把缺的材料和 COTS 加入購物車（${lack.length} 項）</button>` : '<span class="ok">材料和 COTS 都有了或已訂購</span>'}</div></div>
      <div class="pc-cards"><div><span>程式</span><b>${prog.prog >= PROGRAM_HOURS ? '完成' : `${prog.prog.toFixed(1)}/${PROGRAM_HOURS} h`}</b></div><div><span>機器人</span><b>${complete(g) ? '完成' : drivable(g) ? '能開了' : '製作中'}</b></div><div><span>操駕練習</span><b>${g.practice.toFixed(1)} h</b></div><div><span>機台</span><b>${placedMachines(g.machines)}/${SHOPS[g.shop].slots} 格</b></div></div>
      ${rows}`;
  }

  // ---------- Manual ----------
  app_manual() {
    if (!this.g.flags.manual) { this.g.flags.manual = true; this.h.changed(); }
    return `<div class="pc-manual"><nav>${MANUAL.map(([t], i) => `<button data-act="chapter" data-i="${i}" class="${i === this.chapter ? 'on' : ''}">${t}</button>`).join('')}</nav>
      <article><h2>${MANUAL[this.chapter][0]}</h2>${MANUAL[this.chapter][1]}<p class="muted">本手冊是遊戲內的簡化版規則摘要，不是官方手冊。</p></article></div>`;
  }

  app_cad() {
    return `<div class="pc-empty"><h2>CAD</h2><p>${this.g.design ? '修改設計會讓改到的零件重做，並增加細部設計工時。' : '畫出今年的機器人。'}存檔前會檢查周長、高度、重量等規則。</p><button class="primary" data-act="opencad">打開 CAD</button></div>`;
  }

  // ---------- Web shops ----------
  app_web() {
    const v = VENDORS[this.site];
    const tabs = Object.entries(VENDORS).filter(([, x]) => !x.hidden).map(([k, x]) => `<button data-act="site" data-site="${k}" class="${k === this.site ? 'on' : ''}" style="--vc:${x.color}">${x.name}</button>`).join('');
    return `<div class="pc-browser"><div class="pc-url"><span>https://www.${this.site}.example/</span></div><div class="pc-tabs">${tabs}</div>
      <div class="pc-site" style="--vc:${v.color}"><header><h2>${v.name}</h2><span>${v.tag}</span><span class="ship">${this.site === 'quickcut' ? `約 ${v.ship} 天交貨` : `運送 ${v.ship} 天 · 滿 ${money(SHIPPING.free)} 免運`}</span></header>
      ${this.site === 'quickcut' ? this.quickcut() : this.store(this.site)}</div></div>`;
  }

  catalog(site) {
    const items = [];
    for (const [k, x] of Object.entries(MATERIALS)) if (x.vendor === site) items.push(['mat', k, x]);
    for (const [k, x] of Object.entries(COTS)) if (x.vendor === site) items.push(['cots', k, x]);
    if (site === 'maker') {
      for (const [k, x] of Object.entries(MACHINES)) items.push(['machine', k, x]);
      for (const [k, x] of Object.entries(TOOLS)) items.push(['tool', k, x]);
    }
    return items;
  }
  have(type, key) {
    const g = this.g;
    if (type === 'mat') return `${+g.materials[key].toFixed(2)}`;
    if (type === 'cots') return g.cots[key] || 0;
    if (type === 'tool') return g.tools[key];
    return g.machines[key];
  }
  coming(type, key) {
    let n = 0;
    for (const o of [...this.g.orders, ...this.g.boxes]) for (const [t, k, q] of o.items) if (t === type && k === key) n += q;
    return n;
  }
  store(site) {
    const cart = this.carts[site] ??= [];
    const tot = orderTotal(cart);
    const need = new Map(shortages(this.g).map(([t, k, q]) => [`${t}:${k}`, q]));
    return `<div class="pc-store"><div class="pc-grid">${this.catalog(site).map(([type, key, x]) => {
      const n = need.get(`${type}:${key}`), c = this.coming(type, key);
      return `<div class="pc-item${n ? ' need' : ''}"><b>${esc(x.name)}</b>${x.desc ? `<small>${esc(x.desc)}</small>` : ''}
        <div class="price">${money(x.cost)}</div>
        <small>有 ${this.have(type, key)}${type === 'machine' ? ` / 上限 ${x.max}` : ''}${c ? ` · 運送中 ${c}` : ''}${n ? ` · <b>還缺 ${n}</b>` : ''}</small>
        <div class="row"><input type="number" min="1" max="99" value="${n || 1}" data-qty="${type}:${key}"><button data-act="add" data-type="${type}" data-key="${key}">加入購物車</button></div></div>`;
    }).join('')}</div>
      <aside class="pc-cart"><h3>購物車</h3>${cart.length ? cart.map(([type, key, q], i) => `<div class="line"><span>${esc(itemName(type, key))} ×${q}</span><span>${money(itemCost(type, key) * q)}</span><button data-act="rm" data-i="${i}">×</button></div>`).join('') : '<p class="muted">是空的</p>'}
        <div class="line"><span>運費</span><span>${money(tot.ship)}</span></div><div class="line total"><span>合計</span><span>${money(tot.total)}</span></div>
        <button class="primary" data-act="buy"${!cart.length || tot.total > this.g.money ? ' disabled' : ''}>結帳</button>${tot.total > this.g.money ? '<p class="bad">錢不夠</p>' : ''}</aside></div>`;
  }
  quickcut() {
    const g = this.g;
    const list = Object.values(g.parts).filter((p) => !partDone(p) && !p.out && detailed(g, p.sub));
    return `<p>上傳細部設計好的零件圖檔，我們幫你加工，品質穩定。只做還沒開工的件數。</p>
      ${list.length ? `<table class="pc-table"><tr><th>零件</th><th>剩餘</th><th>報價</th><th></th></tr>${list.map((p) => { const left = p.qty - unitsDone(p), c = Math.round(outsourceCost(p) * left / p.qty); return `<tr><td>${esc(p.name)}</td><td>${left}</td><td>${money(c)}</td><td><button data-act="outsource" data-part="${p.id}"${c > g.money ? ' disabled' : ''}>下單</button></td></tr>`; }).join('')}</table>` : '<p class="muted">目前沒有可以外包的零件（要先完成細部設計）。</p>'}`;
  }

  // ---------- Mail ----------
  app_mail() {
    const g = this.g;
    const m = g.mail.find((x) => x.id === this.mailId) || g.mail[0];
    if (m && !m.read) { m.read = true; this.h.changed(); }
    const act = m?.action && !m.action.done ? (m.action.kind === 'grant' ? `<button class="primary" data-act="mailact" data-yes="1">領取 ${money(m.action.amount)}</button>` : `<button class="primary" data-act="mailact" data-yes="1">接受贊助 ${money(m.action.amount)}</button><button data-act="mailact" data-yes="0">婉拒</button>`) : m?.action?.done ? `<p class="muted">${m.action.done}</p>` : '';
    return `<div class="pc-mail"><ul>${g.mail.map((x) => `<li class="${x === m ? 'on' : ''} ${x.read ? '' : 'unread'}" data-act="mail" data-id="${x.id}"><b>${esc(x.from)}</b><span>${esc(x.subject)}</span><small>${fmtDate(x.t)}</small></li>`).join('')}</ul>
      <article>${m ? `<h2>${esc(m.subject)}</h2><p class="muted">${esc(m.from)} · ${fmtDate(m.t)} ${fmtClock(m.t)}</p><div class="pc-mailbody">${esc(m.body).replace(/\n/g, '<br>')}</div>${act}` : '<p class="muted">沒有信件</p>'}</article></div>`;
  }

  // ---------- Programming ----------
  devices() {
    const g = this.g, a = g.design.adv, m = motorsFor(a), out = [];
    for (const [sub, n] of Object.entries(m)) for (let i = 0; i < n; i++) out.push([`${sub}${i}`, `${SUBS[sub].name}馬達 ${i + 1}`]);
    const c = cotsFor(a);
    for (let i = 0; i < (c.drive.encoder || 0); i++) out.push([`enc${i}`, `模組編碼器 ${i + 1}`]);
    out.push(['imu', '陀螺儀'], ['pdh', '電源分配板']);
    return out;
  }
  app_code() {
    const g = this.g;
    if (!g.design) return '<div class="pc-empty"><h2>程式</h2><p>先完成設計，才知道要控制哪些裝置。</p></div>';
    const P = g.program;
    P.ids ??= {};
    P.tune ??= { steer: { kp: 4, kd: 0 }, fly: { kv: 0.05, kp: 0.1 } };
    const devs = this.devices(), ids = devs.map(([k]) => P.ids[k] || 0);
    const dup = new Set(ids.filter((v, i) => v && ids.indexOf(v) !== i));
    const idOk = ids.every((v) => v > 0 && v < 63) && !dup.size;
    const sc = this.scores();
    return `<div class="pc-code">
      <section><h3>1. CAN 裝置編號</h3><p class="muted">每個裝置出廠都是 0 號，要給每個裝置一個不重複的編號（1–62），程式才找得到它們。</p>
        <div class="pc-ids">${devs.map(([k, n]) => `<label class="${dup.has(P.ids[k]) || !P.ids[k] ? 'bad' : ''}">${n}<input type="number" min="0" max="62" value="${P.ids[k] || 0}" data-id="${k}"></label>`).join('')}</div>
        <p>${idOk ? '<b class="ok">✓ 編號都正確</b>' : `<b class="bad">${dup.size ? '有重複的編號' : '還有裝置是 0 號'}</b>`}</p></section>
      <section><h3>2. 控制參數</h3>
        <div class="pc-tune"><div><b>Swerve 轉向（位置控制）</b>
          <label>kP <b>${P.tune.steer.kp.toFixed(1)}</b><input type="range" min="0" max="40" step="0.5" value="${P.tune.steer.kp}" data-tune="steer.kp"></label>
          <label>kD <b>${P.tune.steer.kd.toFixed(2)}</b><input type="range" min="0" max="3" step="0.05" value="${P.tune.steer.kd}" data-tune="steer.kd"></label>
          <canvas id="pc-plot-steer" width="300" height="120"></canvas><small>分數 ${pct(sc.steer)}：要快到目標、又不要衝過頭。</small></div>
        <div><b>飛輪（速度控制）</b>
          <label>kV <b>${P.tune.fly.kv.toFixed(3)}</b><input type="range" min="0" max="0.25" step="0.005" value="${P.tune.fly.kv}" data-tune="fly.kv"></label>
          <label>kP <b>${P.tune.fly.kp.toFixed(2)}</b><input type="range" min="0" max="2" step="0.02" value="${P.tune.fly.kp}" data-tune="fly.kp"></label>
          <canvas id="pc-plot-fly" width="300" height="120"></canvas><small>分數 ${pct(sc.fly)}：轉速要穩在目標上。</small></div></div></section>
      <section><h3>3. 寫程式</h3><p>${P.prog.toFixed(1)} / ${PROGRAM_HOURS} 小時 ${bar(P.prog / PROGRAM_HOURS)}　程式品質 ${pct(this.codeQ(idOk, sc))}</p>
        <button class="primary" data-act="write" data-h="2"${P.prog >= PROGRAM_HOURS ? ' disabled' : ''}>寫 2 小時程式</button> <button data-act="write"${P.prog >= PROGRAM_HOURS ? ' disabled' : ''}>寫到關門</button> <small class="muted">程式品質由編號和參數決定，會影響射球準度和 AUTO。</small></section></div>`;
  }
  codeQ(idOk, sc) { return 0.45 + (idOk ? 0.25 : 0) + 0.15 * sc.steer + 0.15 * sc.fly; }
  // Simulated step responses.
  response(kind) {
    const T = this.g.program.tune, out = [];
    if (kind === 'steer') {
      let x = 0, v = 0;
      const { kp, kd } = T.steer;
      for (let i = 0; i < 300; i++) { const u = Math.max(-12, Math.min(12, kp * (1 - x) - kd * v * 10)); v += (u * 2.2 - v * 1.5) * 0.01; x += v * 0.01; out.push(x); }
    } else {
      let w = 0;
      const { kv, kp } = T.fly, target = 4000;
      for (let i = 0; i < 300; i++) { const u = Math.max(0, Math.min(12, kv * target / 1000 * 2.4 + kp * (target - w) / 400)); w += (u * 410 - w * 1.2) * 0.01 * 0.8; out.push(w / target); }
    }
    return out;
  }
  scores() {
    const s = (r) => {
      const over = Math.max(0, Math.max(...r) - 1), end = Math.abs(r[r.length - 1] - 1);
      const rise = r.findIndex((x) => x >= 0.9);
      const t = rise < 0 ? 3 : rise / 100;
      return Math.max(0, Math.min(1, 1 - over * 2.2 - end * 3 - Math.max(0, t - 0.35) * 0.5));
    };
    return { steer: s(this.response('steer')), fly: s(this.response('fly')) };
  }
  plot() {
    for (const k of ['steer', 'fly']) {
      const c = document.getElementById(`pc-plot-${k}`);
      if (!c) continue;
      const x = c.getContext('2d'), r = this.response(k);
      x.fillStyle = '#0d1117'; x.fillRect(0, 0, 300, 120);
      x.strokeStyle = '#3b4252'; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(0, 30); x.lineTo(300, 30); x.stroke(); x.setLineDash([]);
      x.strokeStyle = '#4ade80'; x.lineWidth = 2; x.beginPath();
      r.forEach((v, i) => { const px = i, py = 110 - Math.max(-0.1, Math.min(1.6, v)) * 80; if (i) x.lineTo(px, py); else x.moveTo(px, py); });
      x.stroke();
    }
  }

  // ---------- Crew ----------
  app_crew() {
    const g = this.g, list = jobs(g);
    return `<div class="pc-crew"><p><label class="pc-check"><input type="checkbox" data-act="autoall"${g.autoAssign ? ' checked' : ''}> 自動分配工作（隊員自己找事做）</label></p>
      <table class="pc-table"><tr><th>隊員</th><th>專長</th><th>技術</th><th>體力</th><th>現在</th><th>指派</th></tr>
      ${g.crew.map((c) => `<tr><td>${esc(c.name)}</td><td>${ROLES[c.role]}</td><td>${'★'.repeat(Math.round(c.skill))}<small> ${c.skill.toFixed(1)}</small></td><td>${bar(c.stamina)}</td>
        <td><small>${c.task ? esc(list.find((j) => j.key === c.task)?.label || c.task) : '—'}</small></td>
        <td><select data-act="assign" data-c="${c.id}"><option value="">${g.autoAssign ? '自動' : '休息'}</option>${list.map((j) => `<option value="${j.key}"${c.task === j.key ? ' selected' : ''}>${esc(j.label)}</option>`).join('')}</select></td></tr>`).join('')}</table>
      <p class="muted">隊員只在學生時間出現（平日 15:00–21:00、週末 9:00–19:00，還要工作室有開）。體力低時做事會變慢，休息會恢復。${g.mode === 'hands' ? '實作模式只有兩位助手，主要靠你自己動手。' : ''}</p></div>`;
  }

  // ---------- Season schedule ----------
  app_season() {
    const g = this.g;
    const rows = g.schedule.map((x) => { const e = eventByKey(x.key), h = g.history.find((r) => r.key === x.key); return `<tr><td>${KIND[x.kind]}</td><td>${esc(shortName(e.name))}</td><td>${e.start.slice(5)}</td><td>${esc(e.state || e.country)}</td><td>${x.status === 'done' ? (h ? `${h.rank ? `第 ${h.rank} 名` : ''}${h.finish ? ` · ${FINISH[h.finish]}` : ''}` : '✓') : x.status === 'active' ? '進行中' : '待出發'}</td></tr>`; }).join('');
    const open = openRegionals(g).slice(0, 40);
    return `<h2>賽程</h2><table class="pc-table"><tr><th>類型</th><th>賽事</th><th>日期</th><th>地點</th><th>狀態</th></tr>${rows || '<tr><td colspan="5">還沒有報名任何比賽</td></tr>'}</table>
      ${g.district ? `<p>地區積分 <b>${g.points}</b> · ${g.qualified.dcmp ? '已晉級地區冠軍賽' : '分區賽結束後決定能不能進地區冠軍賽'}</p>` : ''}${g.qualified.champs ? '<p class="ok">已拿到休士頓冠軍賽資格！</p>' : ''}
      <h2>加報區域賽</h2><p class="muted">每場 ${money(EXTRA_FEE)}，開賽一週前截止，同一週只能去一場。</p>
      <table class="pc-table"><tr><th>週</th><th>日期</th><th>賽事</th><th>地點</th><th>距離</th><th></th></tr>${open.map((e) => `<tr><td>${e.week}</td><td>${e.start.slice(5)}</td><td>${esc(shortName(e.name))}</td><td>${esc(e.state || e.country)}</td><td>${travel(g, e).km.toLocaleString()} km</td><td><button data-act="addreg" data-key="${e.key}"${g.money < EXTRA_FEE ? ' disabled' : ''}>報名</button></td></tr>`).join('')}</table>`;
  }

  // ---------- Travel planning ----------
  app_travel() {
    const g = this.g, list = g.schedule.filter((x) => x.status === 'pending').slice(0, 3);
    if (!list.length) return '<div class="pc-empty"><h2>旅行</h2><p>沒有要去的比賽。</p></div>';
    return list.map((x) => {
      const e = eventByKey(x.key), trip = g.trips[x.key], T = tripTimes(e), t = travel(g, e), n = travelers(g, trip);
      const tp = ticketPrice(g, e), shipAt = trip.mode === 'air' ? null : (T.D - MODES[trip.mode].ship) * 1440 + 8 * 60;
      const locked = trip.stage !== 'plan';
      return `<div class="pc-trip"><h3>${KIND[x.kind]} · ${esc(shortName(e.name))}</h3>
        <p>${esc(e.state || e.country)} · ${t.km.toLocaleString()} km · ${fmtDate(T.depart)} 出發 → ${fmtDate(T.test)} 測試 → ${fmtDate(T.D * 1440)}–${fmtDate((T.D + 2) * 1440)} 比賽 → ${fmtDate(T.home)} 回家</p>
        <div class="pc-steps">
          <div><b>1. 機器人怎麼過去</b>${Object.entries(MODES).map(([k, m]) => { const ok = k !== 'land' || t.land; return `<label class="pc-check"><input type="radio" name="mode-${x.key}" data-act="tmode" data-key="${x.key}" value="${k}"${trip.mode === k ? ' checked' : ''}${!ok || locked || trip.shipped ? ' disabled' : ''}> ${m.name}${ok ? '' : '（過不去）'}</label>`; }).join('')}
            <small class="muted">${MODES[trip.mode].desc}${shipAt ? `<br>最晚 ${fmtDate(shipAt)} 寄出` : ''}</small></div>
          <div><b>2. ${t.bus ? '車票' : '機票'}</b><label>同行隊員<input type="number" min="0" max="${g.crew.length}" value="${trip.crew}" data-act="tcrew" data-key="${x.key}"${trip.tickets ? ' disabled' : ''}></label>
            <small>${n} 人 · 現在每張 ${money(tp)}${t.bus ? '' : '（越早買越便宜）'}</small><br>${trip.tickets >= n ? `<span class="ok">已訂 ${trip.tickets} 張</span>` : `<button data-act="tbook" data-key="${x.key}"${tp * (n - trip.tickets) > g.money ? ' disabled' : ''}>訂 ${n - trip.tickets} 張（${money(tp * (n - trip.tickets))}）</button>`}</div>
          <div><b>3. 飯店（${Math.ceil(n / 4)} 間 × 5 晚）</b>${HOTELS.map((h, i) => `<label class="pc-check"><input type="radio" name="hotel-${x.key}" data-act="thotel" data-key="${x.key}" value="${i}"${trip.hotel === i ? ' checked' : ''}${trip.hotel !== null ? ' disabled' : ''}> ${h.name} ${money(hotelPrice(g, e, i, n))} <small>${h.far}</small></label>`).join('')}
            <small class="muted">${trip.hotel !== null ? '已訂好' : '好飯店讓隊員恢復比較多體力'}</small></div>
          <div><b>4. 測試場地</b>${Object.entries(SITES).map(([k, st]) => `<label class="pc-check"><input type="radio" name="site-${x.key}" data-act="tsite" data-key="${x.key}" value="${k}"${trip.site === k ? ' checked' : ''}${trip.siteReply || trip.siteBooked ? ' disabled' : ''}> ${st.name}${st.cost ? `（${money(st.cost)}）` : ''}</label>`).join('')}
            <small class="muted">${trip.site === 'team' ? (trip.siteReply?.done ? (trip.siteReply.yes ? '對方答應了！' : '對方拒絕了') : '等對方回信中') : SITES[trip.site].desc}</small></div>
          <div><b>5. 打包</b>${trip.shipped ? '<span class="ok">已出貨</span>' : trip.pack ? '<span class="ok">已打包</span>' : '<span class="bad">還沒打包</span>'}<br><small class="muted">到工作室門口的打包區裝箱。</small></div>
        </div></div>`;
    }).join('');
  }

  app_orders() {
    const g = this.g;
    const rows = g.orders.map((o) => `<tr><td>${VENDORS[o.vendor].name}</td><td><small>${o.items.map(([t, k, q]) => `${esc(itemName(t, k))} ×${q}`).join('、')}</small></td><td>${money(o.total)}</td><td>${fmtDate(o.eta)}</td></tr>`).join('');
    const out = Object.values(g.parts).filter((p) => p.out?.eta).map((p) => `<tr><td>QuickCut</td><td>${esc(p.name)} ×${p.out.n}</td><td></td><td>${fmtDate(p.out.eta)}</td></tr>`).join('');
    return `<h2>運送中</h2>${rows || out ? `<table class="pc-table"><tr><th>廠商</th><th>內容</th><th>金額</th><th>到貨</th></tr>${rows}${out}</table>` : '<p class="muted">沒有運送中的訂單。</p>'}
      ${g.boxes.length ? `<p><b>${g.boxes.length} 個包裹</b>放在門口還沒拆。</p>` : ''}
      <h2>工作室日誌</h2><div class="pc-log">${g.log.slice(0, 40).map((l) => `<div><small>${fmtDate(l.t)} ${fmtClock(l.t)}</small> ${esc(l.text)}</div>`).join('')}</div>`;
  }

  // ---------- Events ----------
  click(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const g = this.g, a = el.dataset.act;
    if (a === 'app') { this.app = el.dataset.app; if (this.app === 'cad') { this.h.cad(); return; } }
    else if (a === 'close') { this.h.close(); return; }
    else if (a === 'opencad') { this.h.cad(); return; }
    else if (a === 'chapter') this.chapter = +el.dataset.i;
    else if (a === 'site') this.site = el.dataset.site;
    else if (a === 'add') {
      const q = Math.max(1, Math.min(99, parseInt(this.el.querySelector(`[data-qty="${el.dataset.type}:${el.dataset.key}"]`)?.value, 10) || 1));
      const cart = this.carts[this.site] ??= [];
      const line = cart.find((x) => x[0] === el.dataset.type && x[1] === el.dataset.key);
      if (line) line[2] += q; else cart.push([el.dataset.type, el.dataset.key, q]);
    } else if (a === 'rm') this.carts[this.site].splice(+el.dataset.i, 1);
    else if (a === 'buy') {
      if (checkout(g, this.site, this.carts[this.site])) { this.h.toast(`已向 ${VENDORS[this.site].name} 下單`); this.carts[this.site] = []; this.h.changed(); }
    } else if (a === 'fillcart') {
      for (const [type, key, q] of shortages(g)) {
        const v = { mat: MATERIALS, cots: COTS }[type][key].vendor, cart = this.carts[v] ??= [];
        const line = cart.find((x) => x[0] === type && x[1] === key);
        if (line) line[2] = Math.max(line[2], q); else cart.push([type, key, q]);
      }
      this.app = 'web';
      this.site = Object.keys(this.carts).find((k) => this.carts[k].length) || this.site;
      this.h.toast('缺的東西已經分別加進各家的購物車');
    } else if (a === 'outsource') {
      if (outsource(g, g.parts[el.dataset.part])) { this.h.toast('已下單外包'); this.h.changed(); }
    } else if (a === 'detail') {
      const sub = el.dataset.sub, d = g.detail[sub];
      this.h.passTime(el.dataset.h ? +el.dataset.h : null, `${SUBS[sub].name}細部設計`, (h) => { if (d.done >= d.need) return; d.done = Math.min(d.need, d.done + h * PLAYER_RATE); if (d.done >= d.need) log(g, `${SUBS[sub].name}細部設計完成，零件可以開始做了。`); });
    } else if (a === 'addreg') {
      if (addRegional(g, el.dataset.key)) { this.h.toast('報名完成'); this.h.changed(); }
    } else if (a === 'tbook') {
      const e = eventByKey(el.dataset.key), trip = g.trips[el.dataset.key], n = travelers(g, trip), c = ticketPrice(g, e) * (n - trip.tickets);
      if (c <= g.money) { g.money -= c; g.stats.spent += c; trip.tickets = n; log(g, `訂了 ${n} 張${travel(g, e).bus ? '車票' : '機票'}（${money(c)}）。`); this.h.changed(); }
    } else if (a === 'mail') this.mailId = el.dataset.id;
    else if (a === 'mailact') {
      const m = g.mail.find((x) => x.id === (this.mailId || g.mail[0].id));
      if (m?.action && !m.action.done) {
        if (el.dataset.yes === '1') { g.money += m.action.amount; m.action.done = `已${m.action.kind === 'grant' ? '領取' : '接受'} ${money(m.action.amount)}`; log(g, `${m.from}：${m.action.done}。`); }
        else m.action.done = '已婉拒';
        this.h.changed();
      }
    } else if (a === 'write') {
      this.h.passTime(el.dataset.h ? +el.dataset.h : null, '寫程式', (h) => {
        const P = g.program;
        P.prog = Math.min(PROGRAM_HOURS, P.prog + h * PLAYER_RATE);
        const devs = this.devices(), ids = devs.map(([k]) => P.ids[k] || 0);
        const idOk = ids.every((v) => v > 0 && v < 63) && new Set(ids).size === ids.length;
        P.q = Math.max(P.q, this.codeQ(idOk, this.scores()));
        if (P.prog >= PROGRAM_HOURS) log(g, '程式寫完了。');
      });
    } else return;
    this.render();
  }

  change(e) {
    const t = e.target, g = this.g;
    const trip = t.dataset.key && g.trips[t.dataset.key], ev = t.dataset.key && eventByKey(t.dataset.key);
    if (t.dataset.act === 'tmode') { trip.mode = t.value; this.render(); return; }
    if (t.dataset.act === 'tcrew') { trip.crew = Math.max(0, Math.min(g.crew.length, +t.value || 0)); this.render(); return; }
    if (t.dataset.act === 'thotel') {
      const c = hotelPrice(g, ev, +t.value, travelers(g, trip));
      if (c > g.money) { this.h.toast('錢不夠', 'bad'); this.render(); return; }
      g.money -= c; g.stats.spent += c; trip.hotel = +t.value; log(g, `訂了${HOTELS[trip.hotel].name}（${money(c)}）。`); this.render(); return;
    }
    if (t.dataset.act === 'tsite') {
      if (t.value === 'team') askTeam(g, trip, ev);
      else if (t.value === 'hotel') { g.money -= SITES.hotel.cost; g.stats.spent += SITES.hotel.cost; trip.site = 'hotel'; trip.siteBooked = true; log(g, `向飯店租了測試場地（${money(SITES.hotel.cost)}）。`); }
      else trip.site = 'none';
      this.render(); return;
    }
    if (t.dataset.act === 'method') { g.parts[t.dataset.part].method = t.value; this.h.changed(); this.render(); }
    else if (t.dataset.act === 'assign') {
      const c = g.crew.find((x) => x.id === t.dataset.c);
      c.task = t.value || null; c.auto = !t.value && g.autoAssign;
      if (!t.value && !g.autoAssign) c.auto = false;
      this.render();
    } else if (t.dataset.act === 'autoall') { g.autoAssign = t.checked; for (const c of g.crew) c.auto = t.checked; this.render(); }
    else if (t.dataset.id) { g.program.ids[t.dataset.id] = Math.max(0, Math.min(62, parseInt(t.value, 10) || 0)); this.render(); }
  }
  input(e) {
    const t = e.target;
    if (t.dataset.tune) {
      const [k, f] = t.dataset.tune.split('.');
      this.g.program.tune[k][f] = +t.value;
      t.previousElementSibling.textContent = (+t.value).toFixed(f === 'kv' ? 3 : f === 'kd' || f === 'kp' && k === 'fly' ? 2 : 1);
      this.plot();
      const sc = this.scores(), smalls = this.el.querySelectorAll('.pc-tune small');
      smalls[0].textContent = `分數 ${pct(sc.steer)}：要快到目標、又不要衝過頭。`;
      smalls[1].textContent = `分數 ${pct(sc.fly)}：轉速要穩在目標上。`;
    }
  }
}

const itemName = (type, key) => ({ mat: MATERIALS, cots: COTS, tool: TOOLS, machine: MACHINES }[type][key].name);
const itemCost = (type, key) => ({ mat: MATERIALS, cots: COTS, tool: TOOLS, machine: MACHINES }[type][key].cost);
