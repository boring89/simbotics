import { compile, advanced } from '../parts.js';
import {
  DAY, START_T, dayOf, minOf, weekend, fmtDate, SHOPS, CREW_HOURS, MACHINES, TOOLS, VENDORS, SHIPPING, MATERIALS, COTS,
  SUBS, SUB_ORDER, PROGRAM_HOURS, METHODS, KINDS, opHours, runMinutes, outsourceCost, partsFor, cotsFor, NAMES, ROLES, money,
} from './data.js';

// The career save and everything that moves with time: crew work, machine runs, deliveries,
// outsourced parts and mail. The 3D world only shows this state; skipping time runs it here.

const KEY = 'simbotics.career2.';
export const SLOTS = 3;

export function listSlots() {
  return Array.from({ length: SLOTS }, (_, i) => {
    try { const g = JSON.parse(localStorage.getItem(KEY + i) || 'null'); return g?.v === 2 ? g : null; } catch { return null; }
  });
}
export function load(slot) { return listSlots()[slot]; }
export function save(g) { try { localStorage.setItem(KEY + g.slot, JSON.stringify(g)); } catch { /* storage full or blocked */ } }
export function erase(slot) { try { localStorage.removeItem(KEY + slot); } catch { /* ignore */ } }

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
let uid = Date.now() % 100000;
const id = () => (uid++).toString(36);

// ---------- New game ----------
// opts: { slot, mode: 'hands'|'manage', shop, team: { number, name, real, epa, pct, district, state } }
export function newGame({ slot, mode, shop, team }) {
  const tier = team.real ? (team.pct > 0.9 ? 3 : team.pct > 0.65 ? 2 : team.pct > 0.3 ? 1 : 0) : 0;
  const S = SHOPS[shop];
  const machines = Object.fromEntries(Object.keys(MACHINES).map((k) => [k, S.machines[k] || 0]));
  if (tier >= 2) { machines.band = Math.max(machines.band, 1); machines.printer = Math.max(machines.printer, 1); machines.drill = Math.max(machines.drill, 1); }
  if (tier >= 3) { machines.cnc = 1; machines.lathe = 1; machines.printer = 2; }
  // Machines beyond the floor space stay in storage (sold back at half price).
  let extra = 0;
  while (placed(machines) > S.slots) for (const k of ['printer', 'drill', 'band', 'lathe', 'cnc']) if (machines[k] && placed(machines) > S.slots) { machines[k]--; extra += MACHINES[k].cost / 2; }
  const g = {
    v: 2, slot, mode, shop, created: Date.now(), team: { ...team, tier },
    t: START_T, money: [6000, 11000, 18000, 28000][tier] + S.money + extra, machines,
    tools: Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [k, t.start + tier])),
    materials: Object.fromEntries(Object.keys(MATERIALS).map((k) => [k, 0])),
    cots: Object.fromEntries(Object.keys(COTS).map((k) => [k, 0])),
    orders: [], boxes: [], design: null, rev: 0, detail: {}, parts: {}, subs: {}, runs: [],
    program: { prog: 0, q: 0 }, practice: 0, crew: [], autoAssign: true, mail: [], log: [], flags: {},
    tutorial: true, speed: 1, stats: { made: 0, scrapped: 0, spent: 0 }, ended: false,
    // Competition season.
    district: team.district || null, schedule: [], trips: {}, history: [], points: 0, qualified: { dcmp: false, champs: false },
    health: {}, ev: null, where: 'shop', robotAway: null,
  };
  // The kickoff kit waits at the door: the control system for rookies, a battery and wiring for everyone.
  g.boxes.push({ id: id(), vendor: 'kop', items: [['cots', 'battery', 1], ['cots', 'wiring', 1], ['cots', 'bolts', 1], ...(team.real ? [] : [['cots', 'core', 1], ['cots', 'pdh', 1], ['cots', 'radio', 1], ['cots', 'imu', 1]])] });
  if (tier >= 1) Object.assign(g.materials, { tube2x1: 1, plate18: 1, hex: 1, filament: 1 });
  if (tier >= 2) Object.assign(g.cots, { battery: 2, bolts: 1, wiring: 1 });
  // Crew: a few helpers when you do the work yourself, a full team when you run it.
  const n = mode === 'manage' ? 5 + Math.round(tier * 1.4) : 2;
  const roles = ['mech', 'mech', 'elec', 'prog', 'cad', 'drive', 'mech', 'elec', 'cad', 'prog'];
  const names = [...NAMES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) {
    const base = mode === 'manage' ? 1.6 + tier * 0.7 : 1.2 + tier * 0.4;
    g.crew.push({ id: id(), name: names[i], role: roles[i], skill: clamp(Math.round((base + rnd(-0.8, 1.2)) * 10) / 10, 1, 5), stamina: 1, task: null, auto: true });
  }
  mail(g, '導師', `歡迎來到 ${team.number} ${team.name}！`, `Kickoff 結束了，今年的遊戲是 REBUILT。\n\n門口有今年的 Kickoff 套件，記得拆開。\n\n建議的第一步：\n1. 到電腦打開「規則手冊」看看今年的規則。\n2. 用「CAD」畫出機器人，然後做細部設計。\n3. 在零件商網站訂材料和 COTS（運送要好幾天，越早訂越好）。\n4. 用機台把零件做出來，在推車上組裝。\n\n2/9 之前把底盤做出來會很有幫助。3/2 晚上機器人要裝箱出發去第一場比賽。`);
  if (!team.real) mail(g, 'FIRST 新隊補助', '新隊補助款', '恭喜成為新隊伍！這是給新隊的補助款。', { kind: 'grant', amount: 5000 });
  if (!machines.band || !machines.drill) mail(g, '導師', '機台建議', `工作室現在${machines.drill ? '只有台鑽' : '只有手工具'}，鋁件做不出來。\n\n建議先到 MakerMart 機具城買${machines.band ? '' : '帶鋸機'}${!machines.band && !machines.drill ? '和' : ''}${machines.drill ? '' : '台鑽'}（手工做方管和鋁板），有預算再買 3D 印表機和車床。\n\n買不起的零件可以先外包給 QuickCut，比較貴但品質穩定。`);
  log(g, `Kickoff！${S.name}開工。`);
  return g;
}
const placed = (m) => Object.values(m).reduce((s, v) => s + v, 0);
export const placedMachines = placed;

export function log(g, text) { g.log.unshift({ t: g.t, text }); g.log.length = Math.min(g.log.length, 80); }
export function mail(g, from, subject, body, action = null) { g.mail.unshift({ id: id(), t: g.t, from, subject, body, read: false, action }); }

// ---------- Time ----------
export const shopHours = (g, t = g.t) => SHOPS[g.shop].open[weekend(t) ? 'weekend' : 'weekday'];
export const isOpen = (g, t = g.t) => { const [a, b] = shopHours(g, t), m = minOf(t); return m >= a && m < b; };
export function crewHere(g, t = g.t) {
  const [a, b] = shopHours(g, t), [c, d] = CREW_HOURS[weekend(t) ? 'weekend' : 'weekday'], m = minOf(t);
  return m >= Math.max(a, c) && m < Math.min(b, d);
}
export const closeTime = (g, t = g.t) => dayOf(t) * DAY + shopHours(g, t)[1];
export function nextOpen(g, t = g.t) {
  let d = dayOf(t);
  if (minOf(t) < shopHours(g, t)[0]) return d * DAY + shopHours(g, t)[0];
  d++;
  return d * DAY + shopHours(g, d * DAY)[0];
}

// ---------- Design ----------
const specKey = (p) => JSON.stringify([p.kind, p.mat, p.spec]);
export const designOk = (b) => !!b?.adv && advanced(b.adv).errors.length === 0;

// Saving the CAD: parts whose drawing changed are remade; changed subsystems need more detail
// design and come apart (their COTS go back on the shelf).
export function setDesign(g, build) {
  const a = build.adv, list = partsFor(a), cots = cotsFor(a);
  const old = g.parts, changed = new Set();
  const parts = {};
  for (const p of list) {
    const o = old[p.id];
    const same = o && specKey(o) === specKey(p);
    parts[p.id] = same ? { ...o, qty: p.qty } : { ...p, method: defaultMethod(g, p), done: [], q: [], prog: [], out: null };
    if (!same) changed.add(p.sub);
    const P = parts[p.id];
    // Extra pieces from an earlier, bigger design stay as spares.
    if (same) for (let i = 0; i < P.done.length; i++) P.done[i] = Math.min(P.done[i], p.qty);
  }
  for (const k of Object.keys(old)) if (!parts[k]) changed.add(old[k].sub);
  g.parts = parts;
  for (const sub of SUB_ORDER) {
    const s = g.subs[sub], need = JSON.stringify(cots[sub]);
    const empty = !list.some((p) => p.sub === sub) && !Object.keys(cots[sub]).length;
    if (s && !changed.has(sub) && s.need === need) continue;
    if (s?.installed) for (const [i, q] of Object.entries(s.installed)) g.cots[i] = (g.cots[i] || 0) + q;
    g.subs[sub] = { need, cots: cots[sub], prog: 0, done: empty, q: empty ? 1 : 0, installed: null, skip: empty };
    const D = g.detail[sub];
    if (!D) g.detail[sub] = { need: empty ? 0 : SUBS[sub].detail, done: 0 };
    else if (!empty) D.need = D.done + SUBS[sub].detail * (g.design ? 0.5 : 1);
  }
  const first = !g.design;
  g.design = { ...build, id: 'career' };
  g.rev++;
  log(g, first ? '機器人設計存檔，開始細部設計。' : `設計變更（第 ${g.rev} 版）${changed.size ? `：${[...changed].map((s) => SUBS[s].name).join('、')}要重做` : ''}。`);
  return [...changed];
}

// Default method: the best one we can do with the machines we own.
export function defaultMethod(g, p) {
  const ok = KINDS[p.kind].methods.filter((m) => m !== 'outsource' && methodOk(g, m));
  return ok[0] || 'outsource';
}
export const methodOk = (g, m) => METHODS[m].ops.every((st) => st === 'bench' || g.machines[st] > 0);
export const opsOf = (p) => METHODS[p.method].ops;

// ---------- Parts ----------
export const detailed = (g, sub) => { const d = g.detail[sub]; return !!d && d.done >= d.need - 1e-6; };
export const unitsDone = (p) => (opsOf(p).length ? p.done[opsOf(p).length - 1] || 0 : p.out?.got || 0);
export const partDone = (p) => unitsDone(p) >= p.qty;
export function partQuality(p) {
  const ops = opsOf(p);
  if (!ops.length) return p.out?.got ? METHODS.outsource.cap : 0;
  let s = 0, n = 0;
  for (let i = 0; i < ops.length; i++) if (p.done[i]) { s += p.q[i] / p.done[i]; n++; }
  return n ? Math.min(METHODS[p.method].cap, s / n) : 0;
}
// How many pieces can go through operation i right now (pipeline: each op feeds the next).
export const ready = (p, i) => (i === 0 ? p.qty : p.done[i - 1] || 0) - (p.done[i] || 0);
export const running = (g, p) => g.runs.some((r) => r.part === p.id);
export const haveMaterial = (g, p, n = 1) => g.materials[p.mat] >= p.use * n - 1e-6;
const TOOL_OF = { drill: 'bits', band: 'blade', cnc: 'endmill', lathe: 'insert' };
const STATION_OF_TOOL = { bits: '台鑽', blade: '帶鋸機', endmill: 'CNC', insert: '車床', tap: '攻牙' };
export const toolOk = (g, st, p) => (st === 'bench' ? (p.kind !== 'hex' || g.tools.tap > 0) : !TOOL_OF[st] || g.tools[TOOL_OF[st]] > 0);
export const toolOf = (st, p) => (st === 'bench' ? (p.kind === 'hex' ? 'tap' : null) : TOOL_OF[st]);

// The next operation a part can have at a station, or null (with why).
export function nextOp(g, p, st) {
  if (!detailed(g, p.sub)) return { why: '還沒做細部設計' };
  if (p.out) return { why: '外包中' };
  const ops = opsOf(p);
  if (running(g, p)) return { why: '機台運轉中' };
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i] !== st || ready(p, i) <= 0) continue;
    if (i === 0 && !haveMaterial(g, p, st === 'cnc' ? ready(p, 0) : 1)) return { why: `缺材料：${MATERIALS[p.mat].name}` };
    if (!toolOk(g, st, p)) return { why: `缺耗材：${TOOLS[toolOf(st, p)].name}` };
    return { i, n: ready(p, i) };
  }
  return null;
}

export function useMaterial(g, p, n) { g.materials[p.mat] = Math.max(0, +(g.materials[p.mat] - p.use * n).toFixed(3)); }
export function breakTool(g, st, p) {
  const t = toolOf(st, p);
  if (!t) return;
  g.tools[t] = Math.max(0, g.tools[t] - 1);
  log(g, `${TOOLS[t].name}斷了一支（剩 ${g.tools[t]}）。`);
  if (!g.tools[t]) mail(g, '工作室', `${TOOLS[t].name}用完了`, `${TOOLS[t].name}全部用完了，${STATION_OF_TOOL[t]}的工作都停了。到 MakerMart 機具城補貨。`);
}

// Finish operation i on n pieces with quality q. Scrap (q < 0.35) loses the piece and its material.
// CNC and printer setups start a machine run instead; the pieces count when it finishes.
export function finishOp(g, p, i, q, n = 1, minutes = null) {
  const st = opsOf(p)[i];
  if (q < 0.35 && !((st === 'cnc' || st === 'printer') && i === 0)) {
    for (let k = 0; k < i; k++) { const avg = p.q[k] / p.done[k]; p.done[k]--; p.q[k] -= avg; }
    g.stats.scrapped += n;
    log(g, `${p.name} 報廢了一件（品質太差）。`);
    return 'scrap';
  }
  if ((st === 'cnc' || st === 'printer') && i === 0) {
    const len = minutes ?? runMinutes(p, st) * (st === 'cnc' ? n : 1);
    g.runs.push({ part: p.id, st, i, n, q, left: len, total: len });
    return 'run';
  }
  p.done[i] = (p.done[i] || 0) + n;
  p.q[i] = (p.q[i] || 0) + q * n;
  p.prog[i] = 0;
  if (i === opsOf(p).length - 1) { g.stats.made += n; if (partDone(p)) log(g, `${p.name} ×${p.qty} 全部完成。`); }
  return 'ok';
}

// Run a part through outsourcing: pay and wait.
export function outsource(g, p) {
  const left = p.qty - unitsDone(p), cost = Math.round(outsourceCost(p) * left / p.qty);
  if (cost > g.money || left <= 0) return false;
  g.money -= cost; g.stats.spent += cost;
  p.method = 'outsource';
  p.out = { eta: g.t + VENDORS.quickcut.ship * DAY, got: unitsDone(p), n: left };
  log(g, `${p.name} ×${left} 外包給 QuickCut（${money(cost)}）。`);
  return true;
}

// ---------- Assembly ----------
const NEEDS = { drive: ['frame'], intake: ['frame'], hopper: ['frame'], shooter: ['frame', 'hopper'], climber: ['frame'], controls: ['frame', 'drive'], bumpers: ['frame'] };
export function canBuild(g, sub) {
  const s = g.subs[sub];
  if (g.robotAway) return { why: '機器人不在工作室' };
  if (!s || s.done) return { why: s ? '已完成' : '沒有設計' };
  if (!detailed(g, sub)) return { why: '還沒做細部設計' };
  const pre = (NEEDS[sub] || []).filter((x) => !g.subs[x]?.done);
  if (pre.length) return { why: `要先組好${pre.map((x) => SUBS[x].name).join('、')}` };
  const miss = Object.values(g.parts).filter((p) => p.sub === sub && !partDone(p));
  if (miss.length) return { why: `缺零件：${miss.map((p) => p.name).join('、')}` };
  if (!s.installed) {
    const lack = Object.entries(s.cots).filter(([i, q]) => (g.cots[i] || 0) < q);
    if (lack.length) return { why: `缺 COTS：${lack.map(([i, q]) => `${COTS[i].name} ×${q - (g.cots[i] || 0)}`).join('、')}` };
  }
  return { ok: true };
}
export function installCots(g, sub) {
  const s = g.subs[sub];
  if (s.installed) return;
  for (const [i, q] of Object.entries(s.cots)) g.cots[i] -= q;
  s.installed = { ...s.cots };
}
export function subPartsQ(g, sub) {
  const ps = Object.values(g.parts).filter((p) => p.sub === sub);
  return ps.length ? ps.reduce((s, p) => s + partQuality(p) * p.qty, 0) / ps.reduce((s, p) => s + p.qty, 0) : 0.95;
}
export function finishBuild(g, sub, q) {
  const s = g.subs[sub];
  s.done = true; s.prog = SUBS[sub].build;
  s.q = +(0.55 * subPartsQ(g, sub) + 0.45 * q).toFixed(3);
  log(g, `${SUBS[sub].name}組裝完成（品質 ${Math.round(s.q * 100)}%）。`);
  if (drivable(g) && !g.flags.drivable) { g.flags.drivable = true; log(g, '機器人可以開了！可以去練習場試車。'); }
}
export const drivable = (g) => ['frame', 'drive', 'controls', 'bumpers'].every((s) => g.subs[s]?.done);
export const complete = (g) => !!g.design && SUB_ORDER.every((s) => g.subs[s]?.done) && g.program.prog >= PROGRAM_HOURS;

// ---------- Work for the crew ----------
// Stations: machines by count, 2 workbench spots, 3 laptops, 2 places at the robot cart.
export function capacity(g, st) {
  if (st === 'bench' || st === 'cart') return 2;
  if (st === 'laptop') return 3;
  if (st === 'field') return 1;
  return g.machines[st] || 0;
}
// Every job someone could do right now: { key, label, st, role, pri }.
export function jobs(g) {
  const out = [];
  if (!g.design) return out;
  for (const sub of SUB_ORDER) {
    const d = g.detail[sub];
    if (d && d.done < d.need) out.push({ key: `detail:${sub}`, label: `${SUBS[sub].name}細部設計`, st: 'laptop', role: 'cad', pri: 9 - SUB_ORDER.indexOf(sub) * 0.1 });
  }
  for (const p of Object.values(g.parts)) {
    const ops = opsOf(p);
    for (let i = ops.length - 1; i >= 0; i--) {
      const st = ops[i], nx = nextOp(g, p, st);
      if (nx?.i === i) out.push({ key: `op:${p.id}:${i}`, label: `${p.name}・${({ band: '鋸切', drill: '鑽孔', bench: p.kind === 'hex' ? '攻牙' : '去毛邊', lathe: '車削', cnc: 'CNC 設定', printer: '列印設定' })[st]}`, st, role: 'mech', pri: 6 + i * 0.2 - SUB_ORDER.indexOf(p.sub) * 0.1 });
    }
  }
  for (const sub of SUB_ORDER) if (canBuild(g, sub).ok) out.push({ key: `build:${sub}`, label: `組裝${SUBS[sub].name}`, st: 'cart', role: sub === 'controls' ? 'elec' : 'mech', pri: 8 - SUB_ORDER.indexOf(sub) * 0.1 });
  if (g.program.prog < PROGRAM_HOURS) out.push({ key: 'program', label: '寫程式', st: 'laptop', role: 'prog', pri: g.subs.controls?.done ? 7 : 3 });
  if (drivable(g) && g.cots.battery >= 1 && !g.robotAway) out.push({ key: 'practice', label: '操駕練習', st: 'field', role: 'drive', pri: complete(g) ? 7 : 2 });
  return out;
}
// People and self-running machines using a station.
export const busy = (g, st, except) => g.crew.filter((c) => c !== except && c.task && stationOf(g, c.task) === st).length
  + (g.playerAt === st ? 1 : 0) + g.runs.filter((r) => r.st === st).length;

// Pick the best open job for a member: their own specialty first, then anything.
export function assign(g, c) {
  const list = jobs(g).filter((j) => {
    if (busy(g, j.st, c) >= capacity(g, j.st)) return false;
    if (j.key.startsWith('op:')) return !g.crew.some((o) => o !== c && o.task === j.key) && g.playerJob !== j.key;
    return !(j.key.startsWith('build') && g.playerJob === j.key);
  });
  list.sort((a, b) => (b.pri + (b.role === c.role ? 3 : 0)) - (a.pri + (a.role === c.role ? 3 : 0)));
  c.task = list[0]?.key || null;
  return c.task;
}
// Is a job key still doable?
export function valid(g, key) { return jobs(g).some((j) => j.key === key); }
export function stationOf(g, key) {
  if (key.startsWith('detail') || key === 'program') return 'laptop';
  if (key.startsWith('build')) return 'cart';
  if (key === 'practice') return 'field';
  const [, pid, i] = key.split(':');
  return g.parts[pid] ? opsOf(g.parts[pid])[+i] : null;
}

const speedOf = (c) => (0.2 + 0.08 * c.skill) * (c.stamina > 0.3 ? 1 : 0.55);
const qualityOf = (c, role) => clamp(0.5 + 0.085 * c.skill + (c.role === role ? 0.04 : -0.03) + rnd(-0.06, 0.05), 0.3, 1);

function work(g, c, hours) {
  const key = c.task;
  if (key.startsWith('detail:')) {
    const d = g.detail[key.slice(7)];
    d.done = Math.min(d.need, d.done + hours * (c.role === 'cad' ? 1.2 : 0.8));
    if (d.done >= d.need) { log(g, `${SUBS[key.slice(7)].name}細部設計完成，零件可以開始做了。`); c.task = null; }
  } else if (key === 'program') {
    g.program.prog = Math.min(PROGRAM_HOURS, g.program.prog + hours * (c.role === 'prog' ? 1.2 : 0.6));
    g.program.q = Math.max(g.program.q, qualityOf(c, 'prog'));
    if (g.program.prog >= PROGRAM_HOURS) { log(g, '程式寫完了。'); c.task = null; }
  } else if (key === 'practice') {
    g.practice += hours * (c.role === 'drive' ? 1 : 0.6) * (complete(g) ? 1 : 0.5);
  } else if (key.startsWith('build:')) {
    const sub = key.slice(6), s = g.subs[sub];
    installCots(g, sub);
    s.prog += hours;
    if (s.prog >= SUBS[sub].build) { finishBuild(g, sub, s.pq ?? qualityOf(c, sub === 'controls' ? 'elec' : 'mech')); c.task = null; }
  } else {
    const [, pid, si] = key.split(':'), p = g.parts[pid], i = +si, st = opsOf(p)[i];
    if (!p.prog[i] && i === 0) useMaterial(g, p, st === 'cnc' ? ready(p, 0) : 1);
    p.prog[i] = (p.prog[i] || 0) + hours;
    if (p.prog[i] >= opHours(p, st)) {
      p.prog[i] = 0;
      if (TOOL_OF[st] && Math.random() < 0.03 * (6 - c.skill) / 4) breakTool(g, st, p);
      finishOp(g, p, i, qualityOf(c, 'mech'), st === 'cnc' ? ready(p, 0) : 1);
      c.task = null;
    }
  }
}

// ---------- The clock ----------
// Advance dt game minutes (keep dt small: up to ~10).
export function tick(g, dt) {
  const t0 = g.t;
  g.t += dt;
  // Deliveries land at the door as boxes.
  for (const o of g.orders.filter((x) => x.eta <= g.t)) {
    g.boxes.push({ id: o.id, vendor: o.vendor, items: o.items });
    log(g, `${VENDORS[o.vendor].name} 的包裹到了，放在門口。`);
  }
  g.orders = g.orders.filter((x) => x.eta > g.t);
  for (const p of Object.values(g.parts)) {
    if (p.out && p.out.eta <= g.t) { p.out.got += p.out.n; p.out.eta = null; log(g, `QuickCut 送來 ${p.name} ×${p.out.n}。`); p.out = { got: p.out.got }; p.method = 'outsource'; }
  }
  // Machines that run by themselves.
  for (const r of [...g.runs]) {
    r.left -= dt;
    if (r.left > 0) continue;
    g.runs.splice(g.runs.indexOf(r), 1);
    const p = g.parts[r.part];
    if (!p) continue;
    if (r.q < 0.35) { g.stats.scrapped += r.n; log(g, `${r.st === 'cnc' ? 'CNC' : '3D 列印'}失敗：${p.name} ×${r.n} 報廢。`); continue; }
    p.done[r.i] = (p.done[r.i] || 0) + r.n;
    p.q[r.i] = (p.q[r.i] || 0) + r.q * r.n;
    if (r.i === opsOf(p).length - 1) g.stats.made += r.n;
    log(g, `${r.st === 'cnc' ? 'CNC' : '3D 印表機'}做好了 ${p.name} ×${r.n}。`);
  }
  // Crew.
  const here = g.where === 'shop' && crewHere(g);
  for (const c of g.crew) {
    if (!here || c.away) { c.task = null; c.stamina = Math.min(1, c.stamina + dt / 60 * 0.09); continue; }
    if (c.task && !valid(g, c.task)) c.task = null;
    if (!c.task && (g.autoAssign || c.auto)) assign(g, c);
    if (c.task) { work(g, c, speedOf(c) * dt / 60); c.stamina = Math.max(0, c.stamina - dt / 60 * 0.07); }
    else c.stamina = Math.min(1, c.stamina + dt / 60 * 0.03);
  }
  // Mail on the calendar.
  if (dayOf(g.t) !== dayOf(t0)) newDay(g);
}

// Skip ahead (overnight, "call it a day"): crew keeps working while they're in.
export function advance(g, to) {
  while (g.t < to - 1e-6) {
    const step = crewHere(g) || g.runs.length ? Math.min(5, to - g.t) : Math.min(30, to - g.t);
    tick(g, step);
    if (g.ended) break;
  }
}

const SPONSORS = ['在地機械行', '科技園區半導體廠', '家長會', '五金連鎖', '工程顧問公司', '汽車零件廠', '地方銀行'];
function newDay(g) {
  const d = dayOf(g.t);
  // Students have homework, exams and family: not everyone comes every day.
  for (const c of g.crew) c.away = Math.random() > (weekend(g.t) ? 0.8 : 0.7);
  if (d % 6 === 3 && d < 45 && Math.random() < 0.7) {
    const amount = Math.round(rnd(8, 35)) * 100 * (1 + g.team.tier * 0.3);
    mail(g, SPONSORS[d % SPONSORS.length], '贊助提案', `我們看到貴隊在準備今年的比賽，想贊助 ${money(amount)}。唯一的條件是在機器人上貼我們的 logo。`, { kind: 'sponsor', amount: Math.round(amount) });
  }
  if (d === 30 && !drivable(g)) mail(g, '導師', '進度提醒', '第一場比賽快到了。機器人還不能開的話，先把底盤、驅動、電控和 bumper 做完，至少能上場。');
}

// ---------- Shopping ----------
// cart: [[type, key, qty]] with type 'mat' | 'cots' | 'tool' | 'machine'.
export function itemOf(type, key) { return { mat: MATERIALS, cots: COTS, tool: TOOLS, machine: MACHINES }[type][key]; }
export function orderTotal(cart) {
  const sub = cart.reduce((s, [type, key, q]) => s + itemOf(type, key).cost * q, 0);
  return { sub, ship: sub >= SHIPPING.free || !sub ? 0 : SHIPPING.fee, total: sub + (sub >= SHIPPING.free || !sub ? 0 : SHIPPING.fee) };
}
export function checkout(g, vendor, cart) {
  const { total } = orderTotal(cart);
  if (!cart.length || total > g.money) return false;
  g.money -= total; g.stats.spent += total;
  const eta = g.t + VENDORS[vendor].ship * DAY;
  g.orders.push({ id: id(), vendor, items: cart.map((x) => [...x]), eta, total });
  log(g, `向 ${VENDORS[vendor].name} 下單 ${money(total)}，${fmtDate(eta)} 送達。`);
  return true;
}
// Open a box at the door. Machines go to free floor space (or wait in the box).
export function unbox(g, boxId) {
  const b = g.boxes.find((x) => x.id === boxId);
  if (!b) return null;
  const S = SHOPS[g.shop], out = [];
  for (const [type, key, q] of b.items) {
    if (type === 'mat') g.materials[key] = +(g.materials[key] + q).toFixed(3);
    else if (type === 'cots') g.cots[key] = (g.cots[key] || 0) + q;
    else if (type === 'tool') g.tools[key] += q;
    else if (type === 'machine') {
      const room = S.slots - placed(g.machines), n = Math.min(q, room, MACHINES[key].max - g.machines[key]);
      g.machines[key] += n;
      if (n < q) { const back = (q - n) * MACHINES[key].cost; g.money += back; out.push(`${MACHINES[key].name}沒有空間或已達上限，退貨退款 ${money(back)}`); }
      if (n) for (const p of Object.values(g.parts)) if (!p.done.some(Boolean) && !p.out) p.method = defaultMethod(g, p);
    }
    out.push(`${itemOf(type, key).name} ×${q}`);
  }
  g.boxes = g.boxes.filter((x) => x !== b);
  g.flags.unboxed = true;
  return out;
}

// What the design still needs that we neither have nor ordered.
export function shortages(g) {
  const need = { mat: {}, cots: {} };
  for (const p of Object.values(g.parts)) {
    if (p.out || p.method === 'outsource') continue;
    const left = p.qty - (p.done[0] || 0);
    if (left > 0) need.mat[p.mat] = (need.mat[p.mat] || 0) + p.use * left;
  }
  for (const s of Object.values(g.subs)) if (!s.installed) for (const [i, q] of Object.entries(s.cots)) need.cots[i] = (need.cots[i] || 0) + q;
  const coming = { mat: {}, cots: {} };
  for (const o of [...g.orders, ...g.boxes]) for (const [type, key, q] of o.items) if (coming[type]) coming[type][key] = (coming[type][key] || 0) + q;
  const out = [];
  for (const [k, q] of Object.entries(need.mat)) { const lack = Math.ceil(q - g.materials[k] - (coming.mat[k] || 0) - 1e-6); if (lack > 0) out.push(['mat', k, lack]); }
  for (const [k, q] of Object.entries(need.cots)) { const lack = q - (g.cots[k] || 0) - (coming.cots[k] || 0); if (lack > 0) out.push(['cots', k, lack]); }
  return out;
}

// ---------- The robot as built ----------
// Missing mechanisms don't work; quality scales how well the rest does.
export function robotBuild(g) {
  const b = structuredClone(g.design), mods = {};
  const q = (s) => (g.subs[s]?.done ? g.subs[s].q : 0);
  const prog = g.program.prog >= PROGRAM_HOURS ? g.program.q : 0.3;
  mods.maxSpeed = 0.75 + 0.25 * q('drive'); mods.accel = 0.7 + 0.3 * q('drive');
  mods.spread = 1 + (1 - Math.min(q('shooter'), prog)) * 1.6;
  if (!g.subs.intake?.done) mods.intakeRate = 0.05; else mods.intakeRate = 0.6 + 0.4 * q('intake');
  if (!g.subs.hopper?.done) mods.capacity = 0.1;
  if (!g.subs.shooter?.done) mods.fireRate = 0.02; else mods.fireRate = 0.75 + 0.25 * q('shooter');
  if (!g.subs.climber?.done || g.subs.climber.skip) mods.climbMax = 0;
  b.mods = mods;
  b.name = `${g.team.number} 比賽機器人`;
  return b;
}
export const robotPreset = (g) => compile(robotBuild(g));
export const DRIVER_LEVELS = [[0, '新手'], [6, '普通'], [18, '熟練'], [40, '老手']];
export const driverLevel = (h) => [...DRIVER_LEVELS].reverse().find(([x]) => h >= x)[1];
export { ROLES };
