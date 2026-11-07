import { BOT_SKILL } from './config.js';
import { compile, advanced, WEIGHT_LIMIT } from './parts.js';
import { shotRange } from './robot.js';
import { loadSeason, season, eventByKey, teamInfo, DISTRICTS, percentile } from './season.js';
import {
  newCareer, load, save, setDesign, advanceDay, startEvent, finishEvent, nextEvent, eventDay, fmtDate,
  SUBS, MACHINES, KINDS, COTS, BREAK, REPAIR, SERVICE, START_MONEY, EXTRA_REGIONAL, partHours, chooseWay, shortages, order,
  buyMachine, drivable, complete, driverSkill, shopHours, openRegionals, addRegional, repair, service, playerBuild, prepMatch,
} from './career.js';
import { PitView } from './pit.js';

// Career screens: new-season setup, the team's shop between events, and the pit tab at events.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (x) => `${Math.round(x * 100)}%`;
const bar = (x, cls = '') => `<span class="cr-bar ${cls}"><i style="width:${Math.min(100, x * 100)}%"></i></span>`;
const FINISH = { 1: '冠軍', 2: '亞軍', 3: '第 3 名', 4: '第 4 名', 5: '第 5–6 名', 7: '第 7–8 名' };
const ROLE = ['隊長', '第一指名', '第二指名'];
const KIND = { regional: '區域賽', district: '地區賽', dcmp: '地區冠軍賽', champs: '冠軍賽分區', einstein: 'Einstein' };

export class CareerUI {
  // hooks: { runner, eventUI, builder, testDrive(c), menu() }
  constructor(hooks) {
    this.hooks = hooks;
    this.runner = hooks.runner;
    this.eventUI = hooks.eventUI;
    this.c = load();
    this.tab = 'home';
    this.setup = null;
    this.pitCanvas = document.createElement('canvas');
    this.pitCanvas.className = 'cr-pit-view';
    this.pit = null;
    $('career').addEventListener('click', (e) => this.click(e));
    $('career').addEventListener('change', (e) => this.change(e));
    $('career').addEventListener('input', (e) => this.input(e));
  }

  get builder() { return this.hooks.builder; }
  menu() { this.hooks.menu(); }
  testDrive(c) { this.hooks.testDrive(c); }
  get open() { return !$('career').hidden; }
  hide() { $('career').hidden = true; }

  async show() {
    $('career').hidden = false;
    $('career-body').innerHTML = '<p class="muted">載入 2026 賽季資料…</p>';
    try { await loadSeason(); } catch (err) { $('career-body').innerHTML = `<p>賽季資料載入失敗：${esc(err.message)}</p><button data-act="menu">主選單</button>`; return; }
    if (this.c?.stage === 'event' && this.runner.ev) { this.toEvent(); return; }
    this.render();
  }

  persist() { save(this.c); }

  render() {
    if (!this.open) return;
    if (!this.c) { this.renderSetup(); return; }
    const c = this.c, next = nextEvent(c);
    const atEvent = c.stage === 'event' && this.runner.ev;
    const ready = next && c.day >= next.day - 1;
    const actions = c.ended ? `<button class="primary" data-act="restart">開新的賽季</button>`
      : atEvent ? `<button class="primary" data-act="toEvent">回到 ${esc(eventByKey(c.evKey)?.name)}</button>`
        : ready ? `<button class="primary" data-act="go">出發：${esc(next.event.name)}</button>`
          : `<button class="primary" data-act="day" data-n="1">推進 1 天</button><button data-act="day" data-n="7">推進 7 天</button>${next ? '<button data-act="day" data-n="999">直接到賽事前一天</button>' : '<button data-act="end">結束賽季</button>'}`;
    const tabs = [['home', '總覽'], ['design', '設計'], ['shop', '加工'], ['buy', '採購'], ['season', '賽程']];
    $('career-body').innerHTML = `
      <div class="ev-head">
        <div><span class="season">${c.team.number} ${esc(c.team.name)} · ${c.path === 'district' ? `${DISTRICTS[c.district]}地區` : '區域賽'}</span>
          <h2>${c.ended ? '賽季結束' : `${fmtDate(c.day)}${next ? ` · 距離 ${esc(next.event.name)} ${Math.max(0, next.day - c.day)} 天` : ''}`}</h2></div>
        <div class="ev-tools"><span class="cr-money">${money(c.money)}</span><button data-act="menu">主選單</button><button data-act="quit">放棄生涯</button></div>
      </div>
      ${c.ended ? `<div class="ev-next"><b>${esc(c.ended)}</b>${this.summary()}</div>` : ''}
      <div class="cr-actions">${actions}</div>
      <div class="ev-tabs">${tabs.map(([k, n]) => `<button data-act="tab" data-tab="${k}" class="${k === this.tab ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="ev-view">${this[`tab_${this.tab}`]()}</div>`;
  }

  // ---------- Setup ----------
  renderSetup() {
    const s = this.setup ??= { mode: 'new', number: 10000 + Math.floor(Math.random() * 900), name: '新秀隊', real: 254, path: 'regional', district: 'fim', events: [] };
    const info = s.mode === 'real' ? teamInfo(s.real) : null;
    const list = this.setupEvents();
    const need = s.path === 'district' ? 2 : 2;
    const ok = s.events.length === need && (s.mode === 'new' ? s.number > 0 : !!info);
    $('career-body').innerHTML = `
      <div class="ev-head"><div><span class="season">生涯模式</span><h2>2026 賽季：從 Kickoff 到休士頓</h2></div>
        <div class="ev-tools"><button data-act="menu">主選單</button></div></div>
      <p class="muted">Kickoff（1/10）後開始設計、加工、組裝機器人，再參加真實的 2026 賽事（隊伍名單來自 The Blue Alliance／Statbotics），一路打到休士頓冠軍賽與 Einstein。</p>
      <h4>隊伍</h4>
      <div class="cr-radio"><label><input type="radio" name="cr-mode" value="new"${s.mode === 'new' ? ' checked' : ''}> 新隊伍</label><label><input type="radio" name="cr-mode" value="real"${s.mode === 'real' ? ' checked' : ''}> 接手一支真實隊伍</label></div>
      <div class="grid">
        ${s.mode === 'new'
    ? `<label>隊號<input id="cr-number" type="number" min="1" max="99999" value="${s.number}"></label><label>隊名<input id="cr-name" type="text" maxlength="30" value="${esc(s.name)}"></label>`
    : `<label>隊號<input id="cr-real" type="number" min="1" max="99999" value="${s.real}"></label><div class="cr-team">${info ? `<b>${info.number} ${esc(info.name)}</b><br><span class="muted">${esc(info.state)}${info.district ? ` · ${DISTRICTS[info.district] || info.district}` : ''} · 2026 EPA ${info.epa}（前 ${Math.max(1, Math.round((1 - percentile(info.epa)) * 100))}%）</span>` : '<span class="muted">2026 沒有這支隊伍</span>'}</div>`}
      </div>
      ${s.mode === 'real' ? '<p class="muted">接手後機器人一樣從零開始做；你會在這支隊伍真實參加過的賽事裡佔它的位置。</p>' : ''}
      <h4>賽區</h4>
      <div class="grid"><label>參賽體系<select id="cr-path">
        <option value="regional"${s.path === 'regional' ? ' selected' : ''}>區域賽（贏得區域賽或拿積分池名額進冠軍賽）</option>
        ${Object.entries(DISTRICTS).map(([k, n]) => `<option value="d:${k}"${s.path === 'district' && s.district === k ? ' selected' : ''}>${n}地區（地區積分 → 地區冠軍賽 → 冠軍賽）</option>`).join('')}
      </select></label></div>
      <h4>選 ${need} 場賽事 <span class="muted">（不同週）</span></h4>
      <div class="ev-table cr-events"><table><tr><th></th><th>週</th><th>日期</th><th>賽事</th><th>地點</th><th>隊數</th></tr>
        ${list.map((e) => { const on = s.events.includes(e.key); const clash = !on && s.events.some((k) => eventByKey(k).week === e.week); return `<tr class="${on ? 'me' : ''}"><td><input type="checkbox" data-ev="${e.key}"${on ? ' checked' : ''}${clash || (!on && s.events.length >= need) ? ' disabled' : ''}></td><td>${e.week}</td><td>${e.start.slice(5)}</td><td>${esc(e.name)}${info && e.teams.includes(info.number) ? ' <small class="cr-tag">真實參加</small>' : ''}</td><td>${esc(e.state || e.country)}</td><td>${e.teams.length}</td></tr>`; }).join('')}
      </table></div>
      <p class="muted">起始預算 ${money(START_MONEY)}。${s.path === 'regional' ? `之後可以再花 ${money(EXTRA_REGIONAL)} 報名更多區域賽。` : '兩場地區賽的積分決定能不能進地區冠軍賽。'}</p>
      <button class="primary" data-act="create"${ok ? '' : ' disabled'}>開始賽季</button>`;
  }

  setupEvents() {
    const s = this.setup;
    const evs = s.path === 'district'
      ? season().events.filter((e) => e.type === 'district' && e.district === s.district)
      : season().events.filter((e) => e.type === 'regional');
    return [...evs].sort((a, b) => a.week - b.week || a.name.localeCompare(b.name));
  }

  // ---------- HQ tabs ----------
  tab_home() {
    const c = this.c;
    if (!c.build.adv) return `<div class="ev-next"><p>還沒有設計。先打開 CAD 畫出機器人：設計定案（約 ${c.cad} 小時）之後才能開始加工。</p><button class="primary" data-act="cad">打開 CAD</button></div>${this.logHtml()}`;
    const rows = Object.entries(SUBS).map(([k, S]) => {
      const s = c.subs[k];
      if (!s || !s.need) return '';
      const ps = Object.values(c.parts).filter((p) => p.sub === k);
      const made = ps.filter((p) => p.way && p.done >= partHours(p, p.way) - 1e-6).length;
      const cotsOk = s.installed || Object.entries(s.cots).every(([i, q]) => (c.inventory[i] || 0) >= q);
      const h = c.health[k];
      return `<tr><td>${S.name}</td><td>${ps.length ? `${made}/${ps.length}` : '—'}</td><td>${Object.keys(s.cots).length ? (s.installed ? '已裝' : cotsOk ? '齊了' : '<span class="cr-bad">缺件</span>') : '—'}</td>
        <td>${s.done ? '✓ 完成' : `${bar(s.progress / s.need)} ${pct(s.progress / s.need)}`}</td><td>${s.done ? pct(s.quality) : ''}${h?.wear ? ` <small class="muted">磨耗 ${pct(h.wear)}</small>` : ''}</td></tr>`;
    }).join('');
    const H = shopHours(c);
    return `<div class="cr-cards">
        <div><span>設計</span><b>${c.cad > 0 ? `剩 ${Math.ceil(c.cad)} 小時` : '定案'}</b></div>
        <div><span>機器人</span><b>${complete(c) ? '完成' : drivable(c) ? '能開了' : '製作中'}</b></div>
        <div><span>操駕練習</span><b>${Math.round(c.practice)} 小時 · ${BOT_SKILL[driverSkill(c)].name}</b></div>
        <div><span>今天工時</span><b>${H} 小時 × ${c.crew} 人</b></div>
      </div>
      <div class="ev-table"><table><tr><th>子系統</th><th>加工件</th><th>COTS</th><th>組裝</th><th>品質</th></tr>${rows}</table></div>
      <p class="muted">每天的工時先給設計，再給機台加工、組裝，剩下的拿去練習操駕（機器人要能開）。品質來自加工方式，品質越差在比賽中越容易壞。練習越多，電腦代打你的機器人越強，故障也越少。</p>
      ${drivable(c) ? '<button data-act="test">上場試車（自由練習）</button>' : ''}
      ${this.logHtml()}`;
  }

  logHtml() {
    return `<h4>日誌</h4><div class="cr-log">${this.c.log.slice(0, 18).map((l) => `<div><small>${fmtDate(l.day)}</small> ${esc(l.text)}</div>`).join('')}</div>`;
  }

  tab_design() {
    const c = this.c;
    if (!c.build.adv) return '<p>還沒有設計。</p><button class="primary" data-act="cad">打開 CAD</button>';
    const p = compile(c.build), A = advanced(c.build.adv);
    const range = p.shotSpeed ? shotRange(p.shotSpeed, p.height + 0.1) : 0;
    return `<div class="ev-next"><b>${esc(c.build.name)}</b><br><span class="muted">${esc(p.desc)}</span>
      <table class="cr-stats">
        <tr><td>重量</td><td>${A.weight} / ${WEIGHT_LIMIT} lb</td><td>最高速度</td><td>${p.maxSpeed.toFixed(1)} m/s</td></tr>
        <tr><td>容量</td><td>${p.capacity} 顆</td><td>射速</td><td>${p.fireRate} 顆/秒</td></tr>
        <tr><td>射程</td><td>${range.toFixed(1)} m</td><td>攀爬</td><td>${p.climbMax ? `L${p.climbMax}` : '不爬'}</td></tr>
        <tr><td>TRENCH</td><td>${p.fitsTrench ? '鑽得過' : '鑽不過'}</td><td>高度</td><td>${A.height.toFixed(1)} in</td></tr>
      </table></div>
      <button class="primary" data-act="cad">打開 CAD</button>
      <p class="muted">改設計的代價：改到的子系統要重新設計（每個 5 小時，底盤 12 小時），已做好的加工件作廢，裝上去的 COTS 會拆下來放回庫存。只改飛輪轉速、intake 滾輪轉速、爬升速度不用重做（換齒輪或改程式就好）。改底盤尺寸會連帶驅動、hopper、bumper 一起重做。</p>`;
  }

  tab_shop() {
    const c = this.c;
    const machines = Object.entries(MACHINES).map(([k, M]) => `<tr><td>${M.name}</td><td>${c.machines[k]} / ${M.max}</td><td>${M.labor < 1 ? `每機台小時只要 ${M.labor} 人時` : '全程要人操作'}</td>
      <td>${c.machines[k] < M.max ? `<button data-act="machine" data-m="${k}"${c.money < M.cost ? ' disabled' : ''}>買 ${money(M.cost)}</button>` : ''}</td></tr>`).join('');
    const parts = Object.entries(c.parts).map(([id, p]) => {
      const way = p.way || chooseWay(c, p), total = partHours(p, way);
      return `<tr><td>${SUBS[p.sub].name}</td><td>${esc(p.name)} ×${p.qty}</td><td>${KINDS[p.kind].name}</td><td>${MACHINES[way[0]].name} <small class="muted">品質 ${pct(way[2])}${p.way ? '' : '（預定）'}</small></td>
        <td>${p.done >= total - 1e-6 ? '✓' : `${bar(p.done / total)} ${p.done.toFixed(1)}/${total.toFixed(1)} h`}</td></tr>`;
    }).join('');
    return `<h4>機台</h4><div class="ev-table"><table><tr><th>機台</th><th>數量</th><th>人力</th><th></th></tr>${machines}</table></div>
      <div class="grid"><label>加工方式<select id="cr-pref"><option value="quality"${c.pref === 'quality' ? ' selected' : ''}>品質優先（用最精準的機台）</option><option value="speed"${c.pref === 'speed' ? ' selected' : ''}>速度優先（用最快的方式）</option></select></label></div>
      <p class="muted">CNC 做板件和方管又快又準，還幾乎不佔人力；車床做軸；3D 印表機一次印很久但不用顧。只有手工具也做得出來，但很慢、品質差。還沒開工的零件會依新機台重新安排。</p>
      <h4>加工件</h4>${parts ? `<div class="ev-table"><table><tr><th>子系統</th><th>零件</th><th>材料</th><th>方式</th><th>進度</th></tr>${parts}</table></div>` : '<p class="muted">先存一個設計。</p>'}`;
  }

  tab_buy() {
    const c = this.c, short = shortages(c);
    const total = Object.entries(short).reduce((s, [i, q]) => s + COTS[i].cost * q, 0);
    const rows = Object.entries(short).map(([i, q]) => `<tr><td>${COTS[i].name}</td><td>${q}</td><td>${money(COTS[i].cost * q)}</td><td>${COTS[i].ship} 天</td><td><button data-act="order" data-item="${i}" data-q="${q}"${c.money < COTS[i].cost * q ? ' disabled' : ''}>訂購</button></td></tr>`).join('');
    const inv = Object.entries(c.inventory).filter(([, q]) => q > 0).map(([i, q]) => `${COTS[i]?.name ?? i} ×${q}`).join('、') || '沒有';
    const ship = c.orders.map((o) => `<tr><td>${COTS[o.item].name}</td><td>${o.qty}</td><td>${fmtDate(o.eta)} 到</td></tr>`).join('');
    return `${rows ? `<div class="ev-table"><table><tr><th>缺的 COTS</th><th>數量</th><th>價格</th><th>運送</th><th></th></tr>${rows}</table></div>
      <button class="primary" data-act="orderAll"${total > c.money ? ' disabled' : ''}>全部訂購（${money(total)}）</button>` : '<p>設計需要的 COTS 都有了（或已在路上）。</p>'}
      <h4>運送中</h4>${ship ? `<div class="ev-table"><table>${ship}</table></div>` : '<p class="muted">沒有。</p>'}
      <h4>庫存</h4><p class="muted">${inv}</p>
      <p class="muted">COTS 要等運送天數才會到。組裝時才從庫存拿；改設計拆下來的馬達、模組會放回庫存，可以再用。電控套件（roboRIO、PDH、無線電）在 Kickoff 套件裡。</p>`;
  }

  tab_season() {
    const c = this.c;
    const rows = c.schedule.map((s) => {
      const e = eventByKey(s.key), h = c.history.find((x) => x.key === s.key);
      const res = h ? `${h.rank ? `排名 ${h.rank}/${h.N}` : ''}${h.alliance !== null ? ` · 第 ${h.alliance + 1} 聯盟${ROLE[h.role]}` : ''}${h.finish ? ` · ${FINISH[h.finish]}` : ''}` : s.status === 'skipped' ? '沒去' : '';
      return `<tr class="${s.status === 'pending' && nextEvent(c)?.key === s.key ? 'me' : ''}"><td>${fmtDate(eventDay(s.key))}</td><td>${KIND[s.kind]}</td><td>${esc(e.name)}</td><td>${res}</td></tr>`;
    }).join('');
    const notes = c.history.map((h) => `<li><b>${esc(h.name)}</b>：${esc(h.notes.join(' '))}</li>`).join('');
    const extra = c.path === 'regional' && !c.ended && !c.qualified.champs ? openRegionals(c) : [];
    return `<div class="ev-table"><table><tr><th>日期</th><th>類型</th><th>賽事</th><th>結果</th></tr>${rows}</table></div>
      ${c.path === 'district' ? `<p>地區積分：<b>${c.points}</b>${c.qualified.dcmp ? ' · 已晉級地區冠軍賽' : ''}${c.qualified.champs ? ' · 已拿到冠軍賽資格' : ''}</p>` : `<p>${c.qualified.champs ? '已拿到休士頓冠軍賽資格。' : '還沒拿到冠軍賽資格：贏得一場區域賽，或在區域賽積分池拿到名額。'}</p>`}
      ${notes ? `<ul class="cr-notes">${notes}</ul>` : ''}
      ${extra.length ? `<h4>加報區域賽（${money(EXTRA_REGIONAL)}）</h4><div class="grid"><label>賽事<select id="cr-extra">${extra.map((e) => `<option value="${e.key}">第 ${e.week} 週 ${e.start.slice(5)} · ${esc(e.name)}（${e.teams.length} 隊）</option>`).join('')}</select></label></div><button data-act="extra"${c.money < EXTRA_REGIONAL ? ' disabled' : ''}>報名</button>` : ''}
      <p class="muted">地區積分照 FRC 公式算：資格賽排名 4–22 分、選聯盟（隊長與第一指名 17 − 聯盟序號，第二指名 = 聯盟序號）、淘汰賽冠軍 30／亞軍 20／第 3 名 13／第 4 名 7；地區冠軍賽 ×3。其他隊的積分用 EPA 估算。區域賽積分池簡化成每場除了冠軍聯盟再給積分最高的 2 隊。沒有評審獎項。</p>`;
  }

  summary() {
    const c = this.c;
    return `<ul class="cr-notes">${c.history.map((h) => `<li><b>${esc(h.name)}</b>：${h.rank ? `資格賽第 ${h.rank} 名（${h.record}）` : ''}${h.alliance !== null ? `，第 ${h.alliance + 1} 聯盟${ROLE[h.role]}` : '，沒進淘汰賽'}${h.finish ? `，${FINISH[h.finish]}` : ''}</li>`).join('')}</ul>`;
  }

  // ---------- Pit (a tab on the event screen) ----------
  pitHtml() {
    const c = this.c;
    const rows = Object.entries(BREAK).filter(([k]) => c.subs[k]?.need).map(([k, B]) => {
      const h = c.health[k] || { wear: 0 };
      return `<tr><td>${SUBS[k].name}</td><td>${pct(c.subs[k].quality ?? 1)}</td><td>${bar(h.wear, h.wear > 0.5 ? 'warn' : '')}</td>
        <td>${h.broken ? `<span class="cr-bad">${B.name}</span>` : '正常'}</td>
        <td>${h.broken ? `<button data-act="repair" data-sub="${k}"${c.pitPts < REPAIR ? ' disabled' : ''}>修理（${REPAIR}）</button>` : h.wear > 0.01 ? `<button data-act="service" data-sub="${k}"${c.pitPts < SERVICE ? ' disabled' : ''}>保養（${SERVICE}）</button>` : ''}</td></tr>`;
    }).join('');
    const broken = Object.entries(c.health).filter(([, h]) => h.broken).length;
    return `<div class="cr-pit"><div id="cr-pit-slot" class="cr-pit-slot"></div>
      <div><p>Pit 行動點：<b>${c.pitPts}</b> <span class="muted">（每打完一場 +2）</span></p>
      ${broken ? `<p class="cr-bad">有 ${broken} 個機構壞了，不修的話下一場會影響表現。</p>` : ''}
      <div class="ev-table"><table><tr><th>子系統</th><th>品質</th><th>磨耗</th><th>狀態</th><th></th></tr>${rows}</table></div>
      <p class="muted">品質差、磨耗高的機構比較容易壞；練習時數越多越少壞。壞掉的效果：${Object.values(BREAK).map((b) => b.name).join('、')}。</p></div></div>`;
  }

  pitAfter() {
    const slot = $('cr-pit-slot');
    if (!slot) { this.pit?.stop(); return; }
    slot.appendChild(this.pitCanvas);
    this.pit ??= new PitView(this.pitCanvas);
    const ev = this.runner.ev, me = this.c.team.number;
    const nb = ev ? ev.teams.map((t) => t.number).filter((n) => n !== me).sort((a, b) => Math.abs(a - me) - Math.abs(b - me)).slice(0, 13) : [];
    if (this.pitFor !== this.c.build) { this.pit.show(playerBuild(this.c), me, this.c.team.name, nb); this.pitFor = this.c.build; }
    this.pit.start();
  }

  // ---------- Event hand-off ----------
  ext() {
    const ui = this;
    return {
      get backLabel() { return ui.runner.ev?.phase === 'done' ? '結束賽事，回到基地' : '回到基地'; },
      back: () => this.leaveEvent(),
      tabs: [['pit', 'Pit', () => this.pitHtml()]],
      after: (tab) => { if (tab === 'pit') this.pitAfter(); else this.pit?.stop(); },
      act: (el, act) => {
        if (act === 'repair') { repair(this.c, el.dataset.sub); this.persist(); this.pitFor = null; return true; }
        if (act === 'service') { service(this.c, el.dataset.sub); this.persist(); return true; }
        if (act === 'play' || act === 'sim') { prepMatch(this.c, this.runner.ev); this.runner.save(); this.persist(); }
        return false;
      },
    };
  }

  toEvent() {
    this.hide();
    this.eventUI.use(this.runner, this.ext());
    if (this.runner.ev?.phase === 'quals' || this.runner.ev?.phase === 'playoffs') this.eventUI.tab = null;
    this.eventUI.show();
  }

  leaveEvent() {
    const ev = this.runner.ev;
    this.pit?.stop();
    if (ev?.phase === 'done') {
      finishEvent(this.c, ev);
      this.runner.abandon();
      this.tab = 'season';
      this.persist();
    }
    $('career').hidden = false;
    this.render();
  }

  // ---------- Events ----------
  click(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act, c = this.c;
    if (act === 'menu') { this.hide(); this.menu(); return; }
    if (act === 'create') { this.create(); return; }
    if (act === 'quit' || act === 'restart') {
      if (act === 'quit' && !confirm('放棄這個生涯？進度會刪除。')) return;
      this.c = null; this.setup = null; save(null); this.runner.abandon(); this.render(); return;
    }
    if (act === 'tab') this.tab = el.dataset.tab;
    if (act === 'day') {
      const next = nextEvent(c), n = +el.dataset.n;
      for (let i = 0; i < n; i++) {
        if (next && c.day >= next.day - 1) break;
        advanceDay(c);
      }
    }
    if (act === 'go') { const ev = startEvent(c); this.persist(); this.runner.start(ev); this.pitFor = null; this.toEvent(); return; }
    if (act === 'toEvent') { this.toEvent(); return; }
    if (act === 'cad') {
      this.hide();
      this.builder.showCareer(c.build, c.team.number, (b) => {
        if (b) { setDesign(c, b); this.persist(); }
        $('career').hidden = false;
        this.render();
      });
      return;
    }
    if (act === 'test') { this.hide(); this.testDrive(c); return; }
    if (act === 'machine') buyMachine(c, el.dataset.m);
    if (act === 'order') order(c, el.dataset.item, +el.dataset.q);
    if (act === 'orderAll') for (const [i, q] of Object.entries(shortages(c))) order(c, i, q);
    if (act === 'extra') addRegional(c, $('cr-extra').value);
    if (act === 'end') { c.ended = c.qualified.champs ? '賽季結束。' : '沒拿到冠軍賽資格，賽季結束。'; c.stage = 'done'; }
    this.persist();
    this.render();
  }

  change(e) {
    const t = e.target, s = this.setup;
    if (t.id === 'cr-pref') { this.c.pref = t.value; for (const p of Object.values(this.c.parts)) if (p.done === 0) p.way = null; this.persist(); this.render(); return; }
    if (!s) return;
    if (t.name === 'cr-mode') { s.mode = t.value; s.events = []; if (s.mode === 'real') this.realDefaults(); }
    else if (t.id === 'cr-path') { const v = t.value; s.path = v === 'regional' ? 'regional' : 'district'; if (v !== 'regional') s.district = v.slice(2); s.events = []; }
    else if (t.dataset.ev) { const k = t.dataset.ev; s.events = t.checked ? [...s.events, k] : s.events.filter((x) => x !== k); }
    else if (t.id === 'cr-real') { s.real = +t.value; s.events = []; this.realDefaults(); }
    else return;
    this.render();
  }

  input(e) {
    const t = e.target, s = this.setup;
    if (!s) return;
    if (t.id === 'cr-number') s.number = Math.max(1, Math.min(99999, +t.value || 0));
    if (t.id === 'cr-name') s.name = t.value;
  }

  // A real team: their district (or regionals) and the events they really went to.
  realDefaults() {
    const s = this.setup, info = teamInfo(s.real);
    if (!info) return;
    s.path = info.district && DISTRICTS[info.district] ? 'district' : 'regional';
    if (s.path === 'district') s.district = info.district;
    const real = this.setupEvents().filter((ev) => ev.teams.includes(info.number));
    for (const ev of real) if (s.events.length < 2 && !s.events.some((k) => eventByKey(k).week === ev.week)) s.events.push(ev.key);
  }

  create() {
    const s = this.setup;
    const info = s.mode === 'real' ? teamInfo(s.real) : teamInfo(s.number);
    const number = s.mode === 'real' ? s.real : s.number;
    const name = s.mode === 'real' ? info.name : (s.name.trim() || `Team ${number}`);
    this.c = newCareer({ number, name, real: !!info, path: s.path, district: s.path === 'district' ? s.district : null, events: s.events });
    this.tab = 'home';
    this.persist();
    this.render();
  }
}

