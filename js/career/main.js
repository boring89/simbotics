import * as THREE from '../three.js';
import { Builder } from '../builder.js';
import { loadSeason, teamInfo, percentile, season, eventByKey, shortName, DISTRICTS } from '../season.js';
import { PLACES, distance, eventPlace } from './geo.js';
import { register, EXTRA_FEE, KIND, myMatches } from './compete.js';
import { startDay, checkReplies } from './trip.js';
import { EventFlow } from './eventflow.js';
import { Venue, TestSite } from './venue3d.js';
import { defaultAdvanced, registerBuilds } from '../parts.js';
import {
  SHOPS, SUBS, SUB_ORDER, MACHINES, MATERIALS, TOOLS, COTS, METHODS, PROGRAM_HOURS, fmtDate, fmtClock, money, dayOf, ROLES,
} from './data.js';
import {
  listSlots, load, save, erase, newGame, tick, advance, isOpen, crewHere, closeTime, nextOpen, shopHours, setDesign, designOk, nextOp, ready, opsOf,
  finishOp, useMaterial, breakTool, haveMaterial, toolOk, partDone, partQuality, canBuild, installCots, finishBuild, drivable, complete, unbox,
  jobs, busy, capacity, robotPreset, driverLevel, log, detailed, unitsDone,
} from './state.js';
import { motorsFor } from './data.js';
import { Shop } from './world.js';
import { Computer } from './computer.js';
import { Kickoff } from './kickoff.js';
import { Practice } from './practice.js';
import { BandOp } from './ops/band.js';
import { DrillOp } from './ops/drill.js';
import { LatheOp } from './ops/lathe.js';
import { CncOp } from './ops/cnc.js';
import { PrinterOp } from './ops/printer.js';
import { BenchOp } from './ops/bench.js';
import { AssemblyOp } from './ops/assembly.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const OPS = { band: BandOp, drill: DrillOp, lathe: LatheOp, cnc: CncOp, printer: PrinterOp, bench: BenchOp };
const SPEEDS = [1, 2, 4, 8];

// One-time cleanup of the old menu-based career mode.
try { localStorage.removeItem('simbotics.career'); localStorage.removeItem('simbotics.career.event'); } catch { /* ignore */ }

// ---------- Renderer ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(70, 1, 0.02, 80);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
resize();

// Pointer lock can be refused (no user gesture, page not focused): just ignore that.
const lock = () => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* ignore */ } };

// ---------- State ----------
let g = null, shop = null, place = null, scene = null;
let mode = 'title';      // title | wizard | kickoff | shop (walking anywhere) | op | practice | live | end
let op = null, opInfo = null, kickoff = null, practice = null, practiceOpts = {};
let panelOpen = false;
const keys = new Set();

const computer = new Computer({
  g: () => g,
  cad: () => openCad(),
  passTime: (h, why, after) => passTime(h, why, after),
  toast: (t) => toast(t),
  close: () => closePc(),
  changed: () => { place?.sync(); hud(); },
});
const builder = new Builder({ onUse() {}, onClose() {}, team: () => g?.team.number ?? 0 });
const flow = new EventFlow({
  g: () => g, place: () => place,
  panel: (h, b, w) => panel(h, b, w), closePanel: (r) => closePanel(r), panelOpen: () => panelOpen,
  toast: (t, k) => toast(t, k), hud: () => hud(), setPlace: (p, sc) => setPlace(p, sc), toShop: () => toShop(),
  mode: (m) => { mode = m === 'live' ? 'live' : 'shop'; $('hud').classList.toggle('in-op', m === 'live'); },
  startPractice: (o) => startPractice(o), startAssembly: (sub, cb) => startAssembly(sub, cb), seasonEnd: () => seasonEnd(),
  busy: () => mode !== 'shop' || panelOpen || computer.open || !$('builder').hidden,
  run: (m) => run(m), passMinutes: (m, why, after) => passMinutes(m, why, after), lock: () => lock(),
  setAction: (f) => { panelAction = f; }, setChange: (f) => { panelChange = f; },
});

// Where we walk around: the shop, the test site or the venue.
function setPlace(p, sc) {
  place = p; scene = sc;
  shop = p instanceof Shop ? p : null;
  place.sync?.();
}
function toShop() {
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x1a1c20);
  setPlace(new Shop(sc, g), sc);
  shop.drawScreens();
}

// ---------- Title ----------
function title() {
  mode = 'title';
  scene = null;
  for (const el of ['hud', 'pc', 'panel', 'op', 'kickoff', 'practice-hud']) $(el).hidden = true;
  const slots = listSlots();
  $('title').hidden = false;
  $('title').innerHTML = `<div class="t-wrap"><div class="brand"><span class="season">Simbotics · 生涯模式</span><h1>2026 SEASON</h1><span class="sub">從 Kickoff 到 Einstein：設計、加工、組裝機器人，再帶它去比賽</span></div>
    <div class="t-slots">${slots.map((s, i) => s ? `<div class="t-slot"><b>${s.team.number} ${esc(s.team.name)}</b><span>${SHOPS[s.shop].name} · ${s.mode === 'manage' ? '管理模式' : '實作模式'}</span><span>${fmtDate(s.t)} ${fmtClock(s.t)}${s.ended ? ' · 賽季結束' : s.where === 'venue' ? ' · 比賽中' : ''}</span>
        <div class="row"><button class="primary" data-act="cont" data-i="${i}">繼續</button><button data-act="del" data-i="${i}">刪除</button></div></div>`
    : `<div class="t-slot empty"><b>存檔 ${i + 1}</b><span>空的</span><div class="row"><button class="primary" data-act="new" data-i="${i}">新的賽季</button></div></div>`).join('')}</div>
    <p class="muted">電腦版：鍵盤 + 滑鼠。WASD 移動、滑鼠看、E 互動、Esc 暫停。</p><a href="index.html" class="t-home">← 回首頁</a></div>`;
}
$('title').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const i = +el.dataset.i;
  if (el.dataset.act === 'cont') start(load(i));
  if (el.dataset.act === 'del' && confirm('刪除這個存檔？')) { erase(i); title(); }
  if (el.dataset.act === 'new') wizard(i);
});

// ---------- New game ----------
let wz = null;
async function wizard(slot) {
  mode = 'wizard';
  wz = { slot, step: 0, real: false, number: 10000 + Math.floor(Math.random() * 900), name: '新秀機器人隊', realNo: 254, shop: 'school', mode: 'hands', kickoff: true, place: 'CA', sys: 'regional', events: [] };
  $('title').innerHTML = '<p class="muted">載入 2026 隊伍資料…</p>';
  try { await loadSeason(); } catch { /* real teams unavailable */ }
  drawWizard();
}
function drawWizard() {
  const info = wz.real ? teamInfo(wz.realNo) : null;
  const steps = ['隊伍', '賽區', '工作室', '玩法'];
  let body = '';
  if (wz.step === 0) {
    body = `<div class="w-cards two"><button class="w-card${!wz.real ? ' on' : ''}" data-set="real" data-v="0"><b>創立新隊伍</b><span>從零開始：有新隊補助，但只有基本工具和兩三個人。</span></button>
      <button class="w-card${wz.real ? ' on' : ''}" data-set="real" data-v="1"><b>繼承真實隊伍</b><span>接手一支 2026 年的真實隊伍。強隊有更多預算、機台和有經驗的隊員。</span></button></div>
      ${wz.real ? `<label>隊號<input type="number" id="w-real" value="${wz.realNo}" min="1" max="99999"></label><p>${info ? `<b>${info.number} ${esc(info.name)}</b> · ${esc(info.state || '')} · 2026 EPA ${info.epa}（前 ${Math.max(1, Math.round((1 - percentile(info.epa)) * 100))}%）` : '<span class="bad">找不到這支隊伍</span>'}</p>`
    : `<div class="grid2"><label>隊號<input type="number" id="w-num" value="${wz.number}" min="1" max="99999"></label><label>隊名<input type="text" id="w-name" value="${esc(wz.name)}" maxlength="30"></label></div>`}`;
  } else if (wz.step === 1) {
    body = regionStep(info);
  } else if (wz.step === 2) {
    body = `<div class="w-cards">${Object.entries(SHOPS).map(([k, s]) => `<button class="w-card${wz.shop === k ? ' on' : ''}" data-set="shop" data-v="${k}"><b>${s.name}</b><span>${s.desc}</span>
      <small>${s.size[0]}×${s.size[1]} m · ${s.slots} 個機台位<br>平日 ${hh(s.open.weekday)} · 週末 ${hh(s.open.weekend)}</small></button>`).join('')}</div>`;
  } else {
    body = `<div class="w-cards two"><button class="w-card${wz.mode === 'hands' ? ' on' : ''}" data-set="mode" data-v="hands"><b>實作模式</b><span>你是主力技師：親手操作帶鋸、台鑽、車床、CNC，自己組裝。只有兩位助手幫忙。</span></button>
      <button class="w-card${wz.mode === 'manage' ? ' on' : ''}" data-set="mode" data-v="manage"><b>管理模式</b><span>你是隊長：隊員比較多，自動分工做事；你負責設計、採購、排工作。想做的時候也可以自己動手。</span></button></div>
      <label class="w-check"><input type="checkbox" id="w-ko"${wz.kickoff ? ' checked' : ''}> 播放 Kickoff 開場</label>`;
  }
  const ok = wz.step === 0 ? (wz.real ? !!info : wz.number > 0) : wz.step === 1 ? regionOk() : true;
  $('title').innerHTML = `<div class="t-wrap wide"><div class="w-steps">${steps.map((s, i) => `<span class="${i === wz.step ? 'on' : i < wz.step ? 'done' : ''}">${i + 1}. ${s}</span>`).join('')}</div>${body}
    <div class="row end"><button data-wz="back">${wz.step ? '上一步' : '取消'}</button><button class="primary" data-wz="next"${ok ? '' : ' disabled'}>${wz.step === 3 ? '開始賽季' : '下一步'}</button></div></div>`;
}
const hh = ([a, b]) => `${String(a / 60).padStart(2, '0')}:00–${b >= 1440 ? '24' : String(b / 60).padStart(2, '0')}:00`;
$('title').addEventListener('click', (e) => {
  if (mode !== 'wizard') return;
  const s = e.target.closest('[data-set]'), w = e.target.closest('[data-wz]');
  if (s) {
    wz[s.dataset.set] = s.dataset.set === 'real' ? s.dataset.v === '1' : s.dataset.v;
    if (s.dataset.set === 'real' && wz.real) { const i = teamInfo(wz.realNo); if (i) { wz.place = i.state; wz.sys = i.district ? `d:${i.district}` : 'regional'; wz.events = defaultEvents(i.number); } }
    drawWizard();
  }
  if (w?.dataset.wz === 'back') { if (wz.step) { wz.step--; drawWizard(); } else title(); }
  if (w?.dataset.wz === 'next' && !w.disabled) {
    if (wz.step < 3) { wz.step++; drawWizard(); return; }
    const info = wz.real ? teamInfo(wz.realNo) : null;
    const district = wz.sys.startsWith('d:') ? wz.sys.slice(2) : null;
    const team = info ? { number: info.number, name: info.name, real: true, epa: info.epa, pct: percentile(info.epa), district, state: info.state, place: info.state }
      : { number: wz.number, name: wz.name || '新秀機器人隊', real: false, district, place: wz.place };
    const ng = newGame({ slot: wz.slot, mode: wz.mode, shop: wz.shop, team });
    ng.district = district;
    const evs = wz.events.map(eventByKey);
    register(ng, evs.filter((e) => e.type === 'district').map((e) => e.key), 'district');
    register(ng, evs.filter((e) => e.type === 'regional').map((e) => e.key), 'regional');
    const extra = regionFee();
    if (extra) { ng.money -= extra; ng.stats.spent += extra; }
    save(ng);
    if (wz.kickoff) runKickoff(ng); else start(ng);
  }
});
$('title').addEventListener('input', (e) => {
  if (mode !== 'wizard') return;
  if (e.target.id === 'w-real') { wz.realNo = +e.target.value; drawWizard(); const el = $('w-real'); el.focus(); el.setSelectionRange?.(99, 99); }
  if (e.target.id === 'w-num') wz.number = +e.target.value;
  if (e.target.id === 'w-name') wz.name = e.target.value;
});
$('title').addEventListener('change', (e) => {
  if (mode !== 'wizard') return;
  if (e.target.id === 'w-ko') wz.kickoff = e.target.checked;
  if (e.target.id === 'w-place') { wz.place = e.target.value; drawWizard(); }
  if (e.target.id === 'w-sys') { wz.sys = e.target.value; wz.events = []; drawWizard(); }
  if (e.target.dataset.ev) { const k = e.target.dataset.ev; wz.events = e.target.checked ? [...wz.events, k] : wz.events.filter((x) => x !== k); drawWizard(); }
});

// The region step: where we are, regional or district, and which events to enter.
function regionList() {
  const d = wz.sys.startsWith('d:') ? wz.sys.slice(2) : null;
  return season().events.filter((e) => (d ? e.type === 'district' && e.district === d : false) || e.type === 'regional')
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'district' ? -1 : 1) || a.week - b.week || a.name.localeCompare(b.name));
}
// Included in the fee: two district events, or one regional. Each one more is extra.
function regionFee() {
  const evs = wz.events.map(eventByKey), dist = evs.filter((e) => e.type === 'district').length, reg = evs.filter((e) => e.type === 'regional').length;
  return (wz.sys.startsWith('d:') ? reg : Math.max(0, reg - 1)) * EXTRA_FEE + Math.max(0, dist - 2) * EXTRA_FEE;
}
function regionOk() {
  const evs = wz.events.map(eventByKey);
  return wz.sys.startsWith('d:') ? evs.filter((e) => e.type === 'district').length === 2 : evs.length >= 1;
}
function defaultEvents(n) {
  const i = teamInfo(n);
  return season().events.filter((e) => e.teams.includes(n) && (e.type === 'regional' || (e.type === 'district' && e.district === i.district))).map((e) => e.key);
}
function regionStep(info) {
  const list = regionList(), weeks = new Set(wz.events.map((k) => eventByKey(k).week));
  const dist = wz.sys.startsWith('d:');
  return `<div class="grid2"><label>所在地${info ? `<input type="text" value="${esc(wz.place)}" disabled>` : `<select id="w-place">${PLACES.map((p) => `<option${p === wz.place ? ' selected' : ''}>${p}</option>`).join('')}</select>`}</label>
    <label>參賽體系<select id="w-sys"><option value="regional"${!dist ? ' selected' : ''}>區域賽（贏區域賽或拿積分池名額進冠軍賽）</option>${Object.entries(DISTRICTS).map(([k, n]) => `<option value="d:${k}"${wz.sys === `d:${k}` ? ' selected' : ''}>${n}分區（2 場分區賽 → 地區冠軍賽 → 冠軍賽）</option>`).join('')}</select></label></div>
    <p class="muted">${dist ? '選 2 場分區賽（報名費已含）；也可以像 359、118 一樣多報區域賽，每場 ' : '至少選 1 場區域賽（報名費已含）；之後每多一場 '}${money(EXTRA_FEE)}。同一週只能去一場。</p>
    <div class="w-events"><table class="p-table"><tr><th></th><th>週</th><th>日期</th><th>賽事</th><th>地點</th><th>距離</th><th>隊數</th></tr>
    ${list.map((e) => { const on = wz.events.includes(e.key), clash = !on && weeks.has(e.week); return `<tr class="${on ? 'me' : ''}"><td><input type="checkbox" data-ev="${e.key}"${on ? ' checked' : ''}${clash ? ' disabled' : ''}></td><td>${e.week}</td><td>${e.start.slice(5)}</td><td>${esc(shortName(e.name))}${e.type === 'district' ? ' <small>分區</small>' : ''}${info && e.teams.includes(info.number) ? ' <small class="ok">真實參加</small>' : ''}</td><td>${esc(e.state || e.country)}</td><td>${distance(wz.place, eventPlace(e)).toLocaleString()} km</td><td>${e.teams.length}</td></tr>`; }).join('')}</table></div>
    <p>已選 ${wz.events.length} 場${regionFee() ? ` · 額外報名費 <b>${money(regionFee())}</b>` : ''}</p>`;
}

function runKickoff(ng) {
  $('title').hidden = true;
  mode = 'kickoff';
  kickoff = new Kickoff(renderer, () => { kickoff = null; start(ng); });
}

// ---------- Into the shop ----------
async function start(game) {
  // Real events and teams are needed for anything after kickoff.
  try { await loadSeason(); } catch { /* offline: the build season still works */ }
  g = game;
  g.playerAt = null; g.playerJob = null;
  // Saves from before the competition season existed.
  Object.assign(g, { schedule: g.schedule || [], trips: g.trips || {}, history: g.history || [], points: g.points || 0, qualified: g.qualified || { dcmp: false, champs: false }, health: g.health || {}, where: g.where || 'shop' });
  $('title').hidden = true;
  $('hud').hidden = false;
  mode = g.ended ? 'end' : 'shop';
  if (g.ev?.customs) registerBuilds(g.ev.customs);
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x1c1f26);
  if (g.where === 'venue' && g.ev) setPlace(new Venue(sc, g, g.ev), sc);
  else if (g.where === 'testsite') setPlace(new TestSite(sc, g, flow.trip()?.site || 'hotel'), sc);
  else {
    g.where = 'shop';
    toShop();
    // Arrive at opening time if the shop is closed.
    if (!isOpen(g)) advance(g, nextOpen(g));
  }
  hud(true);
  if (g.ended) seasonEnd();
  else panel(`<h2>${g.team.number} ${esc(g.team.name)}</h2><p>${g.where === 'shop' ? SHOPS[g.shop].name : g.where === 'venue' ? esc(g.ev.title) : '測試場地'} · ${fmtDate(g.t)} ${fmtClock(g.t)}</p>
    <p class="muted">點一下畫面開始。WASD 移動、滑鼠看、靠近東西按 E 互動、1–4 時間速度、Esc 暫停。</p>`, [['開始', () => {}]]);
}

// ---------- Panels ----------
// buttons: [[label, fn, primary?]]; fn returning false keeps the panel open.
function panel(html, buttons = [['關閉', () => {}]], wide = false) {
  panelOpen = true;
  document.exitPointerLock?.();
  const el = $('panel');
  el.hidden = false;
  el.innerHTML = `<div class="p-box${wide ? ' wide' : ''}">${html}<div class="row end">${buttons.map(([l], i) => `<button data-pb="${i}" class="${i === 0 ? 'primary' : ''}">${l}</button>`).join('')}</div></div>`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-pb]');
    if (b) { const keep = buttons[+b.dataset.pb][1]() === false; if (!keep) closePanel(); return; }
    const a = e.target.closest('[data-pa]');
    if (a) panelAction(a);
  };
  el.onchange = (e) => panelChange(e);
}
function closePanel(relock = true) {
  $('panel').hidden = true;
  panelOpen = false;
  if (relock && mode === 'shop') lock();
}
let panelAction = () => {}, panelChange = () => {};

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3800);
}

// ---------- HUD ----------
const TASKS = [
  ['到電腦看規則手冊', (x) => x.flags.manual],
  ['用 CAD 畫出機器人', (x) => !!x.design],
  ['完成一個子系統的細部設計', (x) => Object.values(x.detail).some((d) => d.need > 0 && d.done >= d.need)],
  ['到零件商網站下單（電腦 → 瀏覽器）', (x) => x.orders.length || x.boxes.length || x.flags.unboxed],
  ['拆開門口的包裹', (x) => x.flags.unboxed],
  ['用機台做出第一個零件', (x) => x.stats.made > 0],
  ['在推車上組裝第一個子系統', (x) => SUB_ORDER.some((s) => x.subs[s]?.done && !x.subs[s].skip)],
  ['讓機器人能開（底盤、驅動、電控、Bumper）', (x) => drivable(x)],
  ['到練習場試車', (x) => x.practice > 0.05],
];
let lastLog = null;
function hud(force = false) {
  if (!g) return;
  const open = isOpen(g), close = closeTime(g);
  $('h-date').textContent = `${fmtDate(g.t)} ${fmtClock(g.t)}`;
  $('h-speed').textContent = mode === 'op' || mode === 'practice' || mode === 'live' || flow.live ? '×1' : `×${g.speed}`;
  $('h-money').textContent = money(g.money);
  if (g.where === 'shop') {
    const en = g.schedule.find((x) => x.status === 'pending'), e = en && eventByKey(en.key);
    const left = e ? startDay(e) - 2 - dayOf(g.t) : null;
    $('h-sub').textContent = `${open ? `${close % 1440 ? fmtClock(close) : '24:00'} 關門` : '工作室關著'} · ${crewHere(g) ? `隊員在（${g.crew.filter((c) => c.task).length}/${g.crew.length} 在工作）` : '隊員不在'} · ${e ? `${shortName(e.name)}：${left > 0 ? `${left} 天後出發` : '今天出發'}` : '沒有排定的比賽'}${g.robotAway ? ` · 機器人${g.robotAway === 'packed' ? '已打包' : '不在'}` : ''}`;
  } else $('h-sub').textContent = g.where === 'venue' ? flow.status() : '測試日 · 試車、修理，準備好就前往賽場';
  $('live-hud').hidden = !flow.live;
  if (flow.live) $('live-hud').innerHTML = flow.liveHud();
  if (g.tutorial) {
    const k = TASKS.findIndex(([, f]) => !f(g));
    $('h-tasks').hidden = k < 0;
    if (k >= 0) $('h-tasks').innerHTML = `<b>任務</b><button data-close>×</button>${TASKS.map(([t, f], i) => `<div class="${f(g) ? 'done' : i === k ? 'on' : ''}">${f(g) ? '✓' : '○'} ${t}</div>`).slice(Math.max(0, k - 2), k + 3).join('')}`;
  } else $('h-tasks').hidden = true;
  // New log lines become toasts.
  if (g.log[0] && g.log[0] !== lastLog) {
    const i = lastLog ? g.log.indexOf(lastLog) : 1;
    if (!force) for (const l of g.log.slice(0, i < 0 ? 3 : Math.min(i, 3)).reverse()) toast(l.text);
    lastLog = g.log[0];
  }
}
$('h-tasks').addEventListener('click', (e) => { if (e.target.closest('[data-close]') && g) { g.tutorial = false; hud(); } });

// ---------- Time ----------
let gameAcc = 0;
function run(minutes) {
  gameAcc += minutes;
  while (gameAcc > 0.0001) {
    const s = Math.min(5, gameAcc);
    tick(g, s);
    flow.tick(s);
    gameAcc -= s;
  }
  checkReplies(g);
}
// Time spent on a task away from the shop (repairs, packing): the event keeps going meanwhile.
function passMinutes(min, why, after) {
  const end = g.t + min;
  while (g.t < end - 1e-6) run(Math.min(5, end - g.t));
  after?.();
  place.sync();
  hud();
  toast(`${why}：過了 ${min} 分鐘`);
}
// Fast-forward while the player sits at a task (computer work). after() runs once the time is spent.
// hours: how long, or null for "until closing". after(h) gets the hours actually spent.
function passTime(hours, why, after) {
  const end = closeTime(g), to = Math.min(hours === null ? end : g.t + hours * 60, Math.max(g.t, end));
  const h = (to - g.t) / 60;
  if (h <= 0.01) { toast('已經關門了', 'bad'); return; }
  if (hours !== null && h < hours - 0.01) toast(`快關門了，${why}只做到關門`, 'bad');
  advance(g, to);
  after?.(h);
  place.sync();
  hud();
  computer.render();
  toast(`${why}：過了 ${Math.round(h * 10) / 10} 小時`);
}

// ---------- Interactions ----------
let aim = null;
function interact() {
  if (!aim) return;
  document.exitPointerLock?.();
  if (flow.interact(aim)) return;
  const k = aim.kind;
  if (k === 'computer') { computer.show(); panelOpen = true; }
  else if (k === 'board') boardPanel();
  else if (k === 'machine') machinePanel(aim.key);
  else if (k === 'bench') machinePanel('bench:0');
  else if (k === 'cart') cartPanel();
  else if (k === 'box') {
    const out = unbox(g, aim.key);
    if (out) { toast(`拆箱：${out.join('、')}`); place.sync(); hud(); }
    lock();
  } else if (k === 'shelf') shelfPanel();
  else if (k === 'rack') rackPanel();
  else if (k === 'crew') crewPanel(aim.key);
  else if (k === 'exit') panel('<h2>收工？</h2><p>直接跳到下次開門。隊員會做到他們回家為止。</p>', [['收工回家', () => endDay()], ['再待一下', () => {}]]);
  else if (k === 'field') {
    if (!drivable(g)) panel('<h2>還不能試車</h2><p>要先組好底盤、驅動、電控和 Bumper。</p>');
    else if (g.cots.battery < 1) panel('<h2>沒有電池</h2><p>到 AndyMart 買機器人電池。</p>');
    else startPractice();
  }
}

function closePc() { computer.hide(); panelOpen = false; lock(); hud(); }
function openCad() {
  computer.hide();
  const build = g.design ? structuredClone(g.design) : { id: 'career', name: `${g.team.number} 比賽機器人`, color: 'silver', adv: defaultAdvanced() };
  builder.showCareer(build, g.team.number, (b) => {
    if (b && designOk(b)) {
      const changed = setDesign(g, b);
      shop.sync();
      toast(changed.length ? `設計存檔：${changed.map((s) => SUBS[s].name).join('、')}要重做` : '設計存檔');
      save(g);
    }
    computer.app = 'project';
    computer.show();
  });
}

// Machine (or workbench): pick a part and operation.
function machinePanel(key) {
  const [st, idx] = key.split(':');
  const runs = g.runs.filter((r) => r.st === st);
  const myRun = runs[+idx];
  const free = busy(g, st) < capacity(g, st) || (st === 'bench');
  const list = Object.values(g.parts).filter((p) => opsOf(p).includes(st) && !partDone(p) && !p.out);
  const rows = list.map((p) => {
    const nx = nextOp(g, p, st);
    const ok = nx && nx.i !== undefined;
    const crewOn = g.crew.find((c) => c.task?.startsWith(`op:${p.id}:`));
    const opName = st === 'bench' ? (p.kind === 'hex' ? '攻牙' : '去毛邊') : { band: '鋸切', drill: '鑽孔', lathe: '車削', cnc: 'CNC 加工', printer: '列印' }[st];
    return `<tr><td>${esc(p.name)}<br><small>${SUBS[p.sub].name} · ${METHODS[p.method].name}</small></td><td>${unitsDone(p)}/${p.qty}</td>
      <td>${ok ? `${opName} ×${nx.n} 件可做` : `<small class="muted">${esc(nx?.why || '等前一道工序')}</small>`}</td>
      <td>${ok && !crewOn ? `<button data-pa="op" data-part="${p.id}" data-i="${nx.i}" data-st="${st}" data-idx="${idx}">${st === 'cnc' ? '設定 CNC' : st === 'printer' ? '設定列印' : '親手做'}</button>` : crewOn ? `<small>${esc(crewOn.name)}在做</small>` : ''}</td></tr>`;
  }).join('');
  const name = st === 'bench' ? '工作台' : MACHINES[st].name;
  panelAction = (a) => {
    if (a.dataset.pa !== 'op') return;
    if (!free) { toast('這台機器現在有人在用', 'bad'); return; }
    closePanel(false);
    startOp(g.parts[a.dataset.part], +a.dataset.i, a.dataset.st, +a.dataset.idx);
  };
  const tool = { drill: 'bits', band: 'blade', cnc: 'endmill', lathe: 'insert' }[st];
  panel(`<h2>${name}</h2>
    ${myRun ? `<p class="ok">運轉中：${esc(g.parts[myRun.part]?.name)} ×${myRun.n} · 還要 ${Math.ceil(myRun.left)} 分鐘 ${bar(1 - myRun.left / myRun.total)}</p>` : ''}
    ${!free && !myRun ? '<p class="bad">有隊員正在使用。</p>' : ''}
    ${tool ? `<p class="muted">${TOOLS[tool].name}：剩 ${g.tools[tool]}</p>` : st === 'bench' ? `<p class="muted">螺絲攻：剩 ${g.tools.tap}</p>` : ''}
    ${rows ? `<table class="p-table"><tr><th>零件</th><th>完成</th><th>這台可做</th><th></th></tr>${rows}</table>` : '<p class="muted">目前沒有要在這台做的零件。先在電腦上完成設計、細部設計，並準備好材料。</p>'}`, [['關閉', () => {}]], true);
}
const bar = (x) => `<span class="pc-bar"><i style="width:${Math.min(100, x * 100)}%"></i></span>`;

function startOp(p, i, st, idx) {
  const m = st === 'bench' ? { group: shop.bench.group, ...shop.bench } : shop.machine(st, idx)?.model;
  if (!m) return;
  mode = 'op';
  $('hud').classList.add('in-op');
  g.playerAt = st;
  g.playerJob = `op:${p.id}:${i}`;
  opInfo = { p, i, st, t0: g.t, n: st === 'cnc' ? ready(p, 0) : 1, idx };
  const ctx = {
    g, part: p, i, n: opInfo.n, machine: m, camera, scene, hud: $('op'), shop,
    toast, breakTool: (s) => breakTool(g, s, p),
    done: (q, info) => opDone(q, info, ctx),
    cancel: () => opEnd(),
  };
  $('op').hidden = false;
  op = new OPS[st](ctx);
  op.enter();
}

function opEnd() {
  op?.exit();
  op = null;
  $('op').hidden = true;
  $('hud').classList.remove('in-op');
  g.playerAt = null; g.playerJob = null;
  camera.up.set(0, 1, 0);
  mode = 'shop';
  place.sync();
  hud();
}

function opDone(q, info, ctx) {
  const { p, i, st, t0, n } = opInfo;
  const spent = Math.max(5, g.t - t0);
  opEnd();
  if (i === 0) useMaterial(g, p, n);
  let res;
  if (st === 'cnc' && q < 0.35) { g.stats.scrapped += n; log(g, `CNC 撞機：${p.name} ×${n} 報廢。`); res = 'scrap'; }
  else res = finishOp(g, p, i, q, n, ctx.minutes ?? null);
  save(g);
  const more = ready(p, i);
  const canBatch = res === 'ok' && more > 0 && st !== 'cnc' && st !== 'printer' && (i > 0 || haveMaterial(g, p)) && toolOk(g, st, p);
  const per = Math.round(spent * 0.85);
  const msg = res === 'scrap' ? '<p class="bad">品質太差，這件報廢了，材料也沒了。</p>' : res === 'run' ? `<p>機台開始自己跑了，大約 ${Math.round((ctx.minutes ?? g.runs[g.runs.length - 1]?.total ?? 0))} 分鐘後完成。可以去做別的事。</p>` : '';
  const buttons = [['完成', () => {}]];
  if (canBatch) {
    buttons.unshift([`照樣再做 ${more} 件（約 ${Math.round(per * more / 60 * 10) / 10} 小時）`, () => batch(p, i, st, q, more, per)]);
    buttons.splice(1, 0, ['再親手做一件', () => { startOp(p, i, st, opInfo?.idx ?? 0); }]);
  }
  panel(`<h2>${res === 'scrap' ? '報廢' : res === 'run' ? '開始加工' : '完成'}：${esc(p.name)}</h2><p>品質 <b class="${q >= 0.75 ? 'ok' : q >= 0.5 ? '' : 'bad'}">${pct(q)}</b>${info ? ` · ${esc(info)}` : ''}</p>${msg}
    <p class="muted">${unitsDone(p)}/${p.qty} 件完成 · 這件花了 ${Math.round(spent)} 分鐘</p>`, buttons);
}

// Repeat the same operation on the remaining pieces at about the same quality.
function batch(p, i, st, q, count, per) {
  g.playerAt = st; g.playerJob = `op:${p.id}:${i}`;
  let made = 0;
  for (let k = 0; k < count; k++) {
    if (i === 0 && !haveMaterial(g, p)) { toast('材料用完了', 'bad'); break; }
    if (!toolOk(g, st, p)) { toast('耗材用完了', 'bad'); break; }
    if (g.t + per > closeTime(g)) { toast('快關門了，剩下的下次再做', 'bad'); break; }
    advance(g, g.t + per);
    if (i === 0) useMaterial(g, p, 1);
    if (Math.random() < 0.04 && { band: 1, drill: 1, lathe: 1 }[st]) breakTool(g, st, p);
    const r = finishOp(g, p, i, Math.max(0.36, Math.min(1, q + (Math.random() * 0.1 - 0.07))), 1);
    if (r === 'ok') made++;
  }
  g.playerAt = null; g.playerJob = null;
  place.sync(); hud(); save(g);
  toast(`批次完成 ${made} 件 ${p.name}`);
}

// Robot cart: assemble a subsystem.
function cartPanel() {
  if (!g.design) { panel('<h2>機器人推車</h2><p>還沒有設計。先到電腦用 CAD 畫出機器人。</p>'); return; }
  const rows = SUB_ORDER.filter((s) => g.subs[s] && !g.subs[s].skip).map((s) => {
    const S = g.subs[s], cb = canBuild(g, s), crew = g.crew.find((c) => c.task === `build:${s}`);
    return `<tr><td><b>${SUBS[s].name}</b></td><td>${S.done ? `✓ 品質 ${pct(S.q)}` : S.prog > 0 ? `組裝中 ${pct(S.prog / SUBS[s].build)}` : ''}</td>
      <td>${S.done ? '' : cb.ok ? (crew ? `<small>${esc(crew.name)}在組裝</small>` : S.pq !== undefined ? `<button data-pa="more" data-sub="${s}">繼續組裝</button>` : `<button data-pa="build" data-sub="${s}">親手組裝</button>`) : `<small class="muted">${esc(cb.why)}</small>`}</td></tr>`;
  }).join('');
  panelAction = (a) => {
    if (a.dataset.pa === 'build') { closePanel(false); startAssembly(a.dataset.sub); }
    if (a.dataset.pa === 'more') { const h = keepBuilding(a.dataset.sub); place.sync(); hud(); save(g); toast(`組裝了 ${Math.round(h * 10) / 10} 小時`); cartPanel(); }
  };
  const p = drivable(g) ? robotPreset(g) : null;
  panel(`<h2>機器人推車</h2><table class="p-table">${rows}</table>
    ${p ? `<p>目前性能：最高 ${p.maxSpeed.toFixed(1)} m/s · 容量 ${p.capacity} · 射速 ${p.fireRate}/s · 攀爬 ${p.climbMax ? `L${p.climbMax}` : '不行'}</p>` : ''}
    <p class="muted">程式 ${g.program.prog >= PROGRAM_HOURS ? '完成' : `${g.program.prog.toFixed(1)}/${PROGRAM_HOURS} h`}（電腦 → 程式）</p>`, [['關閉', () => {}]], true);
}

// cb: away from the shop (putting a checked-in robot back together), just report the quality.
function startAssembly(sub, cb) {
  mode = 'op';
  $('hud').classList.add('in-op');
  g.playerAt = 'cart'; g.playerJob = `build:${sub}`;
  opInfo = { sub, t0: g.t };
  const ctx = {
    g, sub, camera, scene, hud: $('op'), shop: place, machine: null, motors: motorsFor(g.design.adv), toast,
    breakTool: () => {}, done: (q, info) => (cb ? (opEnd(), cb(q, info)) : buildDone(sub, q, info)), cancel: () => opEnd(),
  };
  $('op').hidden = false;
  op = new AssemblyOp(ctx);
  op.enter();
}
// The hands-on part is done; the rest of the build hours still have to be put in (now, or later
// by you or the crew).
function buildDone(sub, q, info) {
  const S = g.subs[sub];
  S.prog += (g.t - opInfo.t0) / 60;
  S.pq = q;
  opEnd();
  installCots(g, sub);
  const h = keepBuilding(sub);
  const done = S.done;
  place.sync(); hud(); save(g);
  panel(`<h2>${SUBS[sub].name}${done ? '組裝完成' : '組裝中'}</h2><p>組裝品質 <b>${pct(q)}</b> · ${esc(info || '')}</p>
    <p class="muted">接著接線、調整、測試，又過了 ${Math.round(h * 10) / 10} 小時。${done ? `子系統品質 ${pct(S.q)}。` : `還要 ${Math.round((SUBS[sub].build - S.prog) * 10) / 10} 小時：下次到推車「繼續組裝」，或交給隊員。`}</p>
    ${done && drivable(g) && ['frame', 'drive', 'controls', 'bumpers'].includes(sub) ? '<p class="ok">機器人可以開了，去練習場試試！</p>' : ''}`);
}
// Put in build hours on a started subsystem until it's done or the shop closes.
function keepBuilding(sub) {
  const S = g.subs[sub];
  const h = Math.max(0, Math.min(SUBS[sub].build - S.prog, (closeTime(g) - g.t) / 60));
  g.playerAt = 'cart'; g.playerJob = `build:${sub}`;
  advance(g, g.t + h * 60);
  g.playerAt = null; g.playerJob = null;
  S.prog += h;
  if (!S.done && S.prog >= SUBS[sub].build - 1e-6) finishBuild(g, sub, S.pq ?? 0.8);
  return h;
}

function boardPanel() {
  const list = jobs(g);
  const en = g.schedule.find((x) => x.status === 'pending'), ne = en && eventByKey(en.key);
  const [a, b] = shopHours(g);
  panelAction = () => {};
  panelChange = (e) => {
    const t = e.target;
    if (t.dataset.c) { const c = g.crew.find((x) => x.id === t.dataset.c); c.task = t.value || null; c.auto = !t.value; }
    if (t.id === 'p-auto') { g.autoAssign = t.checked; for (const c of g.crew) c.auto = t.checked; }
  };
  panel(`<h2>白板</h2><div class="p-cols"><div><h3>行事曆</h3><p>今天 ${fmtDate(g.t)} · 工作室 ${fmtClock(a)}–${fmtClock(b % 1440 || 1440 - 1)}</p>
    ${ne ? `<p>下一場：<b>${esc(shortName(ne.name))}</b>（${ne.start.slice(5)}），${startDay(ne) - 2 - dayOf(g.t)} 天後出發</p>` : '<p>沒有排定的比賽</p>'}
    <ul>${g.schedule.map((x) => `<li>${KIND[x.kind]}：${esc(shortName(eventByKey(x.key).name))} ${x.status === 'done' ? '✓' : ''}</li>`).join('')}</ul>
    <ul>${SUB_ORDER.filter((s) => g.subs[s] && !g.subs[s].skip).map((s) => `<li>${g.subs[s].done ? '✓' : '○'} ${SUBS[s].name}${!detailed(g, s) ? '（待細部設計）' : ''}</li>`).join('') || '<li>還沒有設計</li>'}</ul>
    <p>程式：${g.program.prog >= PROGRAM_HOURS ? '✓' : `${g.program.prog.toFixed(1)}/${PROGRAM_HOURS} h`} · 練習：${g.practice.toFixed(1)} h（${driverLevel(g.practice)}）</p></div>
    <div><h3>工作看板</h3><label class="pc-check"><input type="checkbox" id="p-auto"${g.autoAssign ? ' checked' : ''}> 自動分配</label>
    <table class="p-table">${g.crew.map((c) => `<tr><td>${esc(c.name)}<br><small>${ROLES[c.role]} ★${c.skill.toFixed(1)}</small></td><td><select data-c="${c.id}"><option value="">${g.autoAssign ? '自動' : '休息'}</option>${list.map((j) => `<option value="${j.key}"${c.task === j.key ? ' selected' : ''}>${esc(j.label)}</option>`).join('')}</select></td></tr>`).join('')}</table>
    <p class="muted">可做的工作 ${list.length} 項。隊員${crewHere(g) ? '在工作室' : '不在（學生時間才會來）'}。</p></div></div>`, [['關閉', () => {}]], true);
}

function crewPanel(id) {
  const c = g.crew.find((x) => x.id === id);
  if (!c) return;
  const list = jobs(g);
  panelChange = (e) => { if (e.target.dataset.c) { c.task = e.target.value || null; c.auto = !e.target.value; } };
  panelAction = () => {};
  panel(`<h2>${esc(c.name)}</h2><p>${ROLES[c.role]} · 技術 ★${c.skill.toFixed(1)} · 體力 ${pct(c.stamina)}</p>
    <p>${c.task ? `正在：${esc(list.find((j) => j.key === c.task)?.label || '…')}` : '現在沒事做。'}</p>
    <label>指派工作<select data-c="${c.id}"><option value="">自動</option>${list.map((j) => `<option value="${j.key}"${c.task === j.key ? ' selected' : ''}>${esc(j.label)}</option>`).join('')}</select></label>
    <p class="muted">「${['好喔！', '交給我', '這個我會', '今天也要加油', '學長說要先量兩次再切一次'][Math.floor(Math.random() * 5)]}」</p>`);
}

function shelfPanel() {
  const ps = Object.values(g.parts).filter((p) => unitsDone(p) > 0);
  panel(`<h2>零件架</h2>${ps.length ? `<table class="p-table"><tr><th>零件</th><th>完成</th><th>品質</th></tr>${ps.map((p) => `<tr><td>${esc(p.name)}</td><td>${unitsDone(p)}/${p.qty}</td><td>${pct(partQuality(p))}</td></tr>`).join('')}</table>` : '<p class="muted">還沒有做好的零件。</p>'}
    <h3>COTS 庫存</h3><p>${Object.entries(g.cots).filter(([, q]) => q > 0).map(([k, q]) => `${esc(COTS[k].name)} ×${q}`).join('、') || '<span class="muted">沒有</span>'}</p>`, [['關閉', () => {}]], true);
}
function rackPanel() {
  panel(`<h2>材料架</h2><table class="p-table">${Object.entries(MATERIALS).map(([k, m]) => `<tr><td>${esc(m.name)}</td><td>${+g.materials[k].toFixed(2)}</td></tr>`).join('')}</table>
    <h3>耗材</h3><p>${Object.entries(TOOLS).map(([k, t]) => `${t.name} ×${g.tools[k]}`).join('、')}</p>`);
}

// ---------- Day end ----------
function endDay() {
  const t0 = g.t;
  const to = nextOpen(g);
  advance(g, to);
  place.sync();
  save(g);
  const lines = g.log.filter((l) => l.t > t0 - 600).slice(0, 12);
  if (g.ended) { seasonEnd(); return false; }
  panel(`<h2>${fmtDate(g.t)}</h2><p>新的一天，${fmtClock(g.t)} 開門。</p>${lines.length ? `<ul class="p-log">${lines.map((l) => `<li><small>${fmtDate(l.t)} ${fmtClock(l.t)}</small> ${esc(l.text)}</li>`).join('')}</ul>` : ''}`, [['開工', () => {}]]);
  hud(true);
  return false;
}

// The season is over: every event we went to, and how the robot turned out.
function seasonEnd() {
  mode = 'end';
  g.ended = true;
  save(g);
  const FIN = { 1: '冠軍', 2: '亞軍', 3: '第 3 名', 4: '第 4 名', 5: '第 5–6 名', 7: '第 7–8 名' };
  const p = g.design && drivable(g) ? robotPreset(g) : null;
  panel(`<h2>${g.team.number} ${esc(g.team.name)} · 2026 賽季結束</h2>
    <table class="p-table"><tr><th>賽事</th><th>資格賽</th><th>聯盟</th><th>結果</th></tr>${g.history.map((h) => `<tr><td>${KIND[h.kind] || ''} ${esc(h.name)}</td><td>${h.rank ? `${h.rank}/${h.N}（${h.record}）` : '—'}</td><td>${h.alliance !== null ? `第 ${h.alliance + 1} 聯盟` : '—'}</td><td>${h.finish ? FIN[h.finish] : '—'}</td></tr>`).join('') || '<tr><td>沒有參加任何比賽</td></tr>'}</table>
    ${g.district ? `<p>地區積分 ${g.points}</p>` : ''}
    ${p ? `<p>機器人：最高 ${p.maxSpeed.toFixed(1)} m/s · 容量 ${p.capacity} · 射速 ${p.fireRate}/s · ${p.climbMax ? `攀爬 L${p.climbMax}` : '不爬'}</p>` : ''}
    <p>操駕練習 ${g.practice.toFixed(1)} 小時（${driverLevel(g.practice)}）· 花費 ${money(g.stats.spent)} · 剩 ${money(g.money)}</p>`, [['回到標題', () => { title(); }]], true);
}

// ---------- Practice ----------
// opts: { quality (how much the hours count), build (the robot to drive), onEnd() }
function startPractice(opts = {}) {
  closePanel(false);
  mode = 'practice';
  practiceOpts = opts;
  practice = new Practice(renderer, g, opts.build);
  $('hud').hidden = true;
  $('practice-hud').hidden = false;
}
function endPractice() {
  practice = null;
  $('practice-hud').hidden = true;
  $('hud').hidden = false;
  place.sync(); hud(); save(g);
  if (g.ended) { seasonEnd(); return; }
  mode = 'shop';
  if (practiceOpts.onEnd) { practiceOpts.onEnd(); return; }
  panel(`<h2>練習結束</h2><p>累積操駕練習 ${g.practice.toFixed(1)} 小時（${driverLevel(g.practice)}）。</p>`, [['好', () => {}]]);
}

// ---------- Input ----------
canvas.addEventListener('click', () => { if (mode === 'shop' && !panelOpen) lock(); });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && mode === 'shop' && !panelOpen && !computer.open && $('builder').hidden) pause();
});
function pause() {
  save(g);
  panel(`<h2>暫停</h2><p>${fmtDate(g.t)} ${fmtClock(g.t)} · 時間暫停中</p>`, [['繼續', () => {}], ...(g.where === 'shop' ? [['收工（跳到下次開門）', () => endDay()]] : []), ['存檔並回到標題', () => { closePanel(false); title(); return false; }]]);
}
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (mode === 'kickoff' && (e.code === 'Space' || e.code === 'Escape')) { kickoff?.finish(); return; }
  if (mode === 'op') {
    if (e.code === 'Escape') { if (confirm('放棄這次加工？（材料不會扣）')) opEnd(); return; }
    if (!e.repeat) op?.key(e.code, true);
    else if (e.code.startsWith('Arrow')) op?.key(e.code, true);
    return;
  }
  if (mode === 'practice') { if (e.code === 'Escape') endPractice(); else practice?.key(e.code, true); return; }
  if (mode === 'live') { if (!e.repeat) flow.live?.key(e.code, true); return; }
  if (e.code === 'Tab' && g?.where === 'venue' && mode === 'shop') { if (panelOpen) closePanel(); else { document.exitPointerLock?.(); flow.tablet(); } return; }
  if (!$('builder').hidden) return;
  if (computer.open) { if (e.code === 'Escape') closePc(); return; }
  if (panelOpen) { if (e.code === 'Escape' && mode === 'shop') closePanel(); return; }
  if (mode !== 'shop') return;
  keys.add(e.code);
  if (e.code === 'KeyE') interact();
  const sp = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (sp >= 0) { g.speed = SPEEDS[sp]; hud(); toast(`時間速度 ×${g.speed}`); }
  if (e.code === 'KeyT') { g.tutorial = !g.tutorial; hud(); }
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (mode === 'op') op?.key(e.code, false); if (mode === 'practice') practice?.key(e.code, false); if (mode === 'live') flow.live?.key(e.code, false); });
addEventListener('blur', () => keys.clear());
addEventListener('mousemove', (e) => {
  if (mode === 'shop' && document.pointerLockElement === canvas) place.look(e.movementX, e.movementY);
  if (mode === 'op') op?.mouse('move', e);
});
addEventListener('mousedown', (e) => {
  if (mode === 'op' && e.target === canvas) op?.mouse('down', e);
  if (mode === 'practice' && e.button === 0) practice.mouse = true;
  if (mode === 'live' && e.button === 0 && flow.live) flow.live.mouse = true;
});
addEventListener('mouseup', (e) => { if (mode === 'op') op?.mouse('up', e); if (mode === 'practice' && e.button === 0 && practice) practice.mouse = false; if (flow.live && e.button === 0) flow.live.mouse = false; });
addEventListener('wheel', (e) => { if (mode === 'op' && e.target === canvas) op?.wheel(e.deltaY); }, { passive: true });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('beforeunload', () => { if (g) save(g); });

// ---------- Loop ----------
let last = performance.now(), saveT = 0, hudT = 0, screenT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  loop(dt, now);
}
function loop(dt, now) {
  if (mode === 'kickoff' && kickoff) { kickoff.update(dt); kickoff.render(); return; }
  if (mode === 'title' || mode === 'wizard') { renderer.setClearColor(0x0e1116); renderer.clear(); return; }
  if (!g || !place) return;
  const paused = panelOpen && !computer.open && mode === 'shop' && $('panel').querySelector('h2')?.textContent === '暫停';
  // Game time: one real second is one game minute (times the speed). Matches play out in real time.
  if (!paused && mode !== 'end') {
    let sp = mode === 'shop' && (!panelOpen || computer.open) ? g.speed : 1;
    if (flow.fast) sp = 30;
    if (mode === 'live' || flow.live) sp = 1 / 60;
    if (!(panelOpen && !computer.open && mode === 'shop' && !flow.live)) run(dt * sp);
    if (mode === 'practice') g.practice += dt / 60 * (complete(g) ? 1 : 0.6) * (practiceOpts.quality ?? 1);
  }
  if (mode === 'practice' && practice) {
    const s = practice.update(dt);
    $('practice-hud').innerHTML = `<div class="ph-top"><b>練習場</b> · ${fmtDate(g.t)} ${fmtClock(g.t)} · 練習 ${g.practice.toFixed(1)} h（${driverLevel(g.practice)}）</div>
      <div class="ph-card">FUEL <b>${s.fuel}</b> / ${s.cap} · 進球 ${s.scored} · 命中 ${s.shots ? Math.round(s.scored / s.shots * 100) : 0}%${s.climb ? ` · TOWER L${s.climb}` : ''}</div>
      <div class="ph-keys">WASD 移動 · J／L 旋轉 · Space／左鍵 射擊 · C 攀爬 · Esc 結束練習</div>`;
    practice.render();
    return;
  }
  // Closing time at the shop ends the day (not in the middle of an operation).
  if (g.where === 'shop' && mode === 'shop' && !panelOpen && !computer.open && $('builder').hidden && !isOpen(g)) { endDay(); }
  if (mode === 'live') flow.updateLive(dt, camera);
  else if (flow.live) flow.updateLive(dt, camera);
  if (mode === 'shop' && !panelOpen && !computer.open && document.pointerLockElement === canvas) {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    place.walk(dt, f, s, keys.has('ShiftLeft') || keys.has('ShiftRight'));
  }
  if (mode === 'op') op?.update(dt);
  else if (mode !== 'live') place.applyCamera(camera);
  place.updateCrew(dt, g.where === 'shop' ? crewHere(g) : true);
  place.animate(now, g);
  if (g.where !== 'shop') place.placeCart?.();
  if (mode === 'shop') {
    aim = panelOpen || computer.open ? null : place.target(camera);
    const pr = $('prompt');
    pr.hidden = !aim;
    if (aim) pr.innerHTML = `<kbd>E</kbd> ${esc(aim.label)}${aimStatus(aim)}`;
  }
  hudT += dt; saveT += dt; screenT += dt;
  if (hudT > 0.25) { hudT = 0; hud(); computer.tick(); place.sync(); }
  if (screenT > 2 || (flow.live && screenT > 0.5)) { screenT = 0; place.drawScreens(screenInfo()); }
  if (saveT > 60) { saveT = 0; save(g); }
  renderer.render(scene, camera);
}
// What the venue's big screen and schedule board show.
function screenInfo() {
  if (g.where !== 'venue' || !g.ev) return null;
  const L = flow.live;
  return {
    screen: L ? `${L.id} · ${L.clock.phase} ${L.clock.t}` : g.ev.phase === 'quals' ? '資格賽' : g.ev.phase === 'selection' ? '選聯盟' : g.ev.phase === 'playoffs' ? '淘汰賽' : '閉幕',
    score: L ? L.score : null,
    mine: myMatches(g.ev).map((m) => ({ id: m.id, t: m.t, note: m.result ? '✓' : '' })),
  };
}
function aimStatus(a) {
  if (a.kind !== 'machine' || !shop) return '';
  const [st, idx] = a.key.split(':');
  const r = g.runs.filter((x) => x.st === st)[+idx];
  if (r) return ` <small>（運轉中 ${pct(1 - r.left / r.total)}）</small>`;
  const c = g.crew.find((x) => x.task && x.task.startsWith('op:') && opsOf(g.parts[x.task.split(':')[1]] || { method: 'outsource' })[+x.task.split(':')[2]] === st);
  return c ? ` <small>（${esc(c.name)}在用）</small>` : '';
}
requestAnimationFrame(frame);
title();

// Debug handle.
window.career = { loop: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) loop(dt, performance.now() + i * dt * 1000); }, get mode() { return mode; }, get g() { return g; }, get shop() { return shop; }, get place() { return place; }, get op() { return op; }, flow, run: (m) => run(m), advance: (h) => { advance(g, g.t + h * 60); place.sync(); hud(); }, camera, startOp: (pid, i, st) => startOp(g.parts[pid], i, st, 0), startAssembly };
