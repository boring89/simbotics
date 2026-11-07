import { defaultAdvanced, registerBuilds } from './parts.js';
import { makeEvent, makePlayoffs, rankings, finishes, lineup, team as evTeam } from './event.js';
import { season, eventByKey, teamInfo, teamRobot, dateOf } from './season.js';

// Career mode: one 2026 season from kickoff to Houston. Design the robot (the builder's advanced
// mode is the CAD), make the parts on the machines you own, order COTS, assemble, then play real
// events with their real rosters. All state is plain JSON in localStorage.

const KEY = 'simbotics.career';
export const EV_KEY = 'simbotics.career.event';
export const KICKOFF = new Date('2026-01-10T12:00:00');
export const dayDate = (d) => new Date(KICKOFF.getTime() + d * 864e5);
export const dayOf = (date) => Math.round((date - KICKOFF) / 864e5);
export const fmtDate = (d) => { const t = dayDate(d); return `${t.getMonth() + 1}/${t.getDate()}（${'日一二三四五六'[t.getDay()]}）`; };
const weekend = (d) => [0, 6].includes(dayDate(d).getDay());

export const START_MONEY = 16000;
export const EXTRA_REGIONAL = 4000;
const CREW = 4;              // students working each shop day
const CAD_START = 45;        // design hours before anything can be made

export const SUBS = {
  frame: { name: '底盤', hours: 20 },
  drive: { name: '驅動', hours: 16 },
  controls: { name: '電控與程式', hours: 36 },
  intake: { name: 'Intake', hours: 16 },
  hopper: { name: 'Hopper／Indexer', hours: 16 },
  shooter: { name: '射手', hours: 20 },
  climber: { name: '攀爬', hours: 12 },
  bumpers: { name: 'Bumper', hours: 12 },
};
const ORDER = Object.keys(SUBS);

// labor: student-hours used per machine-hour (a CNC mostly runs by itself).
export const MACHINES = {
  hand: { name: '手工具', cost: 0, labor: 1, start: 1, max: 1 },
  drill: { name: '鑽床', cost: 450, labor: 1, start: 1, max: 2 },
  band: { name: '帶鋸', cost: 900, labor: 1, start: 1, max: 2 },
  cnc: { name: 'CNC 路由機', cost: 6500, labor: 0.3, start: 0, max: 2 },
  lathe: { name: '車床', cost: 3200, labor: 0.8, start: 0, max: 1 },
  printer: { name: '3D 印表機', cost: 900, labor: 0.1, start: 0, max: 4 },
};
// Ways to make each kind of part: [machine, hours per unit, quality].
export const KINDS = {
  plate: { name: '鋁板', ways: [['cnc', 5, 1], ['drill', 14, 0.72], ['hand', 24, 0.55]] },
  tube: { name: '方管', ways: [['cnc', 3.5, 1], ['drill', 7, 0.85], ['hand', 12, 0.6]] },
  shaft: { name: '軸', ways: [['lathe', 2, 1], ['band', 4, 0.78], ['hand', 7, 0.6]] },
  print: { name: '3D 列印件', ways: [['printer', 12, 0.88], ['hand', 10, 0.55]] },
  poly: { name: '聚碳酸酯板', ways: [['cnc', 3, 1], ['band', 7, 0.78], ['hand', 10, 0.6]] },
};
export const COTS = {
  swerve: { name: 'Swerve 模組', cost: 520, ship: 7 },
  mecanum: { name: 'Mecanum 輪組（4 輪）', cost: 380, ship: 4 },
  kraken: { name: 'Kraken X60', cost: 200, ship: 5 },
  vortex: { name: 'NEO Vortex', cost: 160, ship: 5 },
  neo: { name: 'NEO', cost: 110, ship: 4 },
  belts: { name: '皮帶、滑輪、軸承包', cost: 140, ship: 3 },
  wheels: { name: '飛輪與滾輪組', cost: 90, ship: 3 },
  gearbox: { name: '減速箱', cost: 180, ship: 5 },
  turret: { name: '砲塔轉盤軸承', cost: 260, ship: 6 },
  battery: { name: '電池', cost: 120, ship: 3 },
  bumper: { name: 'Bumper 布料與木板', cost: 220, ship: 4 },
};

// What breaking a mechanism does to the robot in the next match (multipliers on the preset).
export const BREAK = {
  frame: { name: '框架變形', mods: { maxSpeed: 0.85, accel: 0.8 } },
  drive: { name: '模組故障', mods: { maxSpeed: 0.6, accel: 0.6, maxOmega: 0.6 } },
  controls: { name: '斷電／CAN 掉線', mods: { maxSpeed: 0.8, fireRate: 0.7 } },
  intake: { name: 'Intake 卡住', mods: { intakeRate: 0.25 } },
  hopper: { name: 'Indexer 卡球', mods: { capacity: 0.5, fireRate: 0.7 } },
  shooter: { name: '飛輪皮帶斷', mods: { fireRate: 0.35, spread: 2.5 } },
  climber: { name: '攀爬機構壞', mods: { climbMax: 0 } },
};

// ---------- Design -> parts ----------
// Per subsystem: fabricated parts [key, name, kind, qty, size] and COTS { item: qty }.
export function bom(a) {
  const round = a.shape === 'round', L = round ? a.diameter : a.length, W = round ? a.diameter : a.width;
  const fixed = a.shooterType === 'fixed', n = a.shooters.length, m = a.motor;
  const area = L * W / 729;
  return {
    frame: { fab: [['rail', '底盤框管', 'tube', 4, 1], ['belly', '底板', 'plate', 1, 1.5 * area]], cots: {} },
    drive: { fab: [], cots: a.drive === 'mecanum' ? { mecanum: 1, [m]: 4 } : { swerve: 4, [m]: 8 } },
    controls: { fab: [['ebrd', '電控板', 'poly', 1, 1]], cots: { battery: 3 } },
    intake: {
      fab: [['iside', 'Intake 側板', 'plate', 2, 1], ['iroll', '滾輪軸', 'shaft', Math.max(2, Math.round(a.intakeWidth / 8)), 1], ...(a.intakeExt > 0 ? [['islide', '滑軌座', 'print', 2, 1]] : [])],
      cots: { [m]: a.intakeExt > 0 ? 2 : 1, belts: 1 },
    },
    hopper: {
      fab: [['hwall', 'Hopper 牆板', 'poly', a.expand ? 4 : 2, a.hopperHeight / 18], ['iplate', 'Indexer 板', 'plate', 2, 1]],
      cots: { [m]: a.indexer === 'floor' ? 2 : 1, belts: 1 },
    },
    shooter: fixed
      ? { fab: [['sside', '射手側板', 'plate', 2 * n, 1], ['sshaft', '滾筒軸', 'shaft', 2 * n, 1], ['hood', 'Hood', 'print', n, 1]], cots: { [m]: 2 * n, wheels: n } }
      : { fab: [['tplate', '砲塔底板', 'plate', n, 1.3], ['sside', '射手側板', 'plate', 2 * n, 1], ['sshaft', '飛輪軸', 'shaft', a.wheels * n, 1], ['hood', 'Hood', 'print', n, 1]], cots: { [m]: (a.wheels + 1) * n, wheels: n, turret: n } },
    climber: a.climb ? { fab: [['ctube', '攀爬臂', 'tube', a.climb > 1 ? 4 : 2, 1], ['hook', '掛鉤', 'plate', 2, 1]], cots: { [m]: a.climb > 1 ? 2 : 1, gearbox: 1 } } : { fab: [], cots: {} },
    bumpers: { fab: [], cots: { bumper: 1 } },
  };
}

// What has to be remade when the design changes. Flywheel speed, intake roller speed and climb
// speed are just gearing/software and change nothing.
function signatures(a) {
  const dims = [a.shape, a.length, a.width, a.diameter];
  return {
    frame: dims, drive: [...dims, a.drive, a.motor, a.ratio], controls: [a.motor],
    intake: [a.intakeWidth, a.intakeExt, a.motor], hopper: [...dims, a.hopperHeight, a.expand, a.indexer],
    shooter: [a.shooterType, a.wheels, a.fixedDir, JSON.stringify(a.shooters), a.motor],
    climber: [a.climb, a.motor], bumpers: dims,
  };
}

// ---------- New career ----------
export function newCareer({ number, name, real, path, district, events }) {
  const machines = Object.fromEntries(Object.entries(MACHINES).map(([k, m]) => [k, m.start]));
  const c = {
    v: 1, team: { number, name, real }, path, district: district || null,
    day: 0, money: START_MONEY, crew: CREW, pref: 'quality',
    build: { id: 'career', name: '比賽機器人', color: 'silver', adv: null },
    cad: CAD_START, subs: {}, parts: {}, inventory: { battery: 2 }, orders: [], machines,
    practice: 0, log: [], schedule: [], history: [], stage: 'build', evKey: null,
    health: {}, pitPts: 0, seen: [], qualified: { dcmp: false, champs: false }, points: 0, ended: null,
  };
  for (const k of events) c.schedule.push({ key: k, kind: path === 'district' ? 'district' : 'regional', status: 'pending' });
  c.schedule.sort((x, y) => dateOf(eventByKey(x.key)) - dateOf(eventByKey(y.key)));
  log(c, `Kickoff！2026 賽季 REBUILT 開始。先在「設計」打開 CAD 畫出機器人。`);
  return c;
}

export function log(c, text) { c.log.unshift({ day: c.day, text }); c.log.length = Math.min(c.log.length, 60); }

export function load() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c?.v === 1 ? c : null; } catch { return null; }
}
export function save(c) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

// ---------- Design changes ----------
// Saving the CAD: subsystems whose signature changed lose their made parts and assembly
// (COTS come back to the shelf) and cost design time to redo.
export function setDesign(c, build) {
  const a = build.adv, sig = signatures(a), B = bom(a);
  const first = !c.build.adv;
  const changed = [];
  for (const sub of ORDER) {
    const s = sig[sub].join('|');
    const old = c.subs[sub];
    if (old && old.sig === s) continue;
    if (old) {
      changed.push(sub);
      for (const [item, q] of Object.entries(old.installed || {})) c.inventory[item] = (c.inventory[item] || 0) + q;
      for (const id of Object.keys(c.parts)) if (id.startsWith(`${sub}.`)) delete c.parts[id];
    }
    const need = B[sub].fab.length || Object.keys(B[sub].cots).length ? SUBS[sub].hours : 0;
    c.subs[sub] = { sig: s, progress: 0, need, done: need === 0, installed: null, cots: B[sub].cots, quality: 1 };
    for (const [key, pname, kind, qty, size] of B[sub].fab) c.parts[`${sub}.${key}`] = { sub, name: pname, kind, qty, size, done: 0, way: null };
  }
  c.build = { ...build, id: 'career' };
  if (!first && changed.length) {
    const hours = changed.reduce((h, s) => h + (s === 'frame' ? 12 : 5), 0);
    c.cad += hours;
    log(c, `設計變更：${changed.map((s) => SUBS[s].name).join('、')} 要重做（設計 ${hours} 小時）。`);
  } else if (first) log(c, '機器人設計存檔。設計定案後就能開始加工。');
  return changed;
}

export const partHours = (p, way) => way[1] * p.qty * p.size;

// The way this part gets made with the machines we own.
export function chooseWay(c, p) {
  const ways = KINDS[p.kind].ways.filter(([m]) => c.machines[m] > 0);
  if (c.pref === 'speed') return [...ways].sort((x, y) => x[1] - y[1])[0];
  return [...ways].sort((x, y) => y[2] - x[2] || x[1] - y[1])[0];
}

// COTS still to buy: everything the design uses minus what's installed, on the shelf or ordered.
export function shortages(c) {
  const need = {};
  for (const s of Object.values(c.subs)) {
    if (s.installed) continue;
    for (const [item, q] of Object.entries(s.cots)) need[item] = (need[item] || 0) + q;
  }
  const out = {};
  for (const [item, q] of Object.entries(need)) {
    const have = (c.inventory[item] || 0) + c.orders.filter((o) => o.item === item).reduce((n, o) => n + o.qty, 0);
    if (q > have) out[item] = q - have;
  }
  return out;
}

export function order(c, item, qty) {
  const cost = COTS[item].cost * qty;
  if (cost > c.money) return false;
  c.money -= cost;
  c.orders.push({ item, qty, eta: c.day + COTS[item].ship });
  log(c, `訂購 ${COTS[item].name} ×${qty}（$${cost}，${COTS[item].ship} 天後到）。`);
  return true;
}

export function buyMachine(c, m) {
  const M = MACHINES[m];
  if (c.machines[m] >= M.max || c.money < M.cost) return false;
  c.money -= M.cost;
  c.machines[m]++;
  // Parts not started yet may now have a better way.
  for (const p of Object.values(c.parts)) if (p.done === 0) p.way = null;
  log(c, `買了 ${M.name}（$${M.cost}）。`);
  return true;
}

// ---------- One shop day ----------
const subReady = (c, sub) => Object.values(c.parts).filter((p) => p.sub === sub).every((p) => p.way && p.done >= partHours(p, p.way) - 1e-6);
export const drivable = (c) => ['frame', 'drive', 'controls', 'bumpers'].every((s) => c.subs[s]?.done);
export const complete = (c) => c.build.adv && ORDER.every((s) => c.subs[s]?.done);

export function shopHours(c) {
  const next = nextEvent(c);
  const crunch = next && next.day - c.day <= 10;
  return weekend(c.day) ? 8 : crunch ? 5 : 3;
}

export function advanceDay(c) {
  const H = shopHours(c);
  let labor = c.crew * H;
  // COTS deliveries.
  for (const o of c.orders.filter((x) => x.eta <= c.day)) {
    c.inventory[o.item] = (c.inventory[o.item] || 0) + o.qty;
    log(c, `${COTS[o.item].name} ×${o.qty} 到貨。`);
  }
  c.orders = c.orders.filter((x) => x.eta > c.day);
  if (c.build.adv) {
    // Design first: two students on CAD.
    if (c.cad > 0) {
      const use = Math.min(c.cad, 2 * H);
      c.cad -= use; labor -= use;
      if (c.cad <= 0) { c.cad = 0; log(c, '設計定案，可以開始加工了。'); }
    }
    if (c.cad <= 0) {
      const cap = Object.fromEntries(Object.entries(c.machines).map(([m, n]) => [m, n * H]));
      const parts = Object.entries(c.parts).sort(([, a], [, b]) => ORDER.indexOf(a.sub) - ORDER.indexOf(b.sub));
      for (const [, p] of parts) {
        p.way ??= chooseWay(c, p);
        const total = partHours(p, p.way);
        if (p.done >= total - 1e-6) continue;
        const [m] = p.way, rate = MACHINES[m].labor;
        const work = Math.min(total - p.done, cap[m], labor / rate);
        if (work <= 0) continue;
        p.done += work; cap[m] -= work; labor -= work * rate;
        if (p.done >= total - 1e-6) log(c, `${p.name} ×${p.qty} 完成（${MACHINES[m].name}）。`);
      }
      // Assembly: the frame first, then everything bolts onto it.
      for (const sub of ORDER) {
        const s = c.subs[sub];
        if (s.done || labor <= 0) continue;
        if (sub !== 'frame' && !c.subs.frame.done) continue;
        if (sub === 'controls' && !c.subs.drive.done) continue;
        if (!subReady(c, sub)) continue;
        if (!s.installed) {
          if (!Object.entries(s.cots).every(([item, q]) => (c.inventory[item] || 0) >= q)) continue;
          for (const [item, q] of Object.entries(s.cots)) c.inventory[item] -= q;
          s.installed = { ...s.cots };
        }
        const work = Math.min(labor, s.need - s.progress);
        s.progress += work; labor -= work;
        if (s.progress >= s.need - 1e-6) {
          s.done = true;
          s.quality = subQuality(c, sub);
          log(c, `${SUBS[sub].name}組裝完成。`);
          if (drivable(c) && sub !== 'frame' && ['drive', 'controls', 'bumpers'].includes(sub) && ['drive', 'controls', 'bumpers'].every((x) => c.subs[x].done)) log(c, '機器人可以開了！剩下的人力會拿去練習操駕。');
        }
      }
    }
  }
  // Whatever time is left: drive practice once the robot moves (half as useful without every mechanism).
  if (drivable(c) && labor > 0) c.practice += Math.min(labor / c.crew, H) * (complete(c) ? 0.6 : 0.3);
  c.day++;
}

function subQuality(c, sub) {
  const ps = Object.values(c.parts).filter((p) => p.sub === sub && p.way);
  if (!ps.length) return 0.95;
  let h = 0, q = 0;
  for (const p of ps) { const t = partHours(p, p.way); h += t; q += t * p.way[2]; }
  return q / h;
}

export function driverSkill(c) {
  const h = c.practice;
  return h < 12 ? 'easy' : h < 35 ? 'medium' : h < 75 ? 'hard' : 'einstein';
}
export const shakedown = (c) => Math.min(0.6, c.practice / 150);

// ---------- Season schedule ----------
export const eventDay = (key) => dayOf(dateOf(eventByKey(key)));
export function nextEvent(c) {
  const e = c.schedule.find((s) => s.status === 'pending');
  return e ? { ...e, day: eventDay(e.key), event: eventByKey(e.key) } : null;
}

// Regionals still open for an extra registration.
export function openRegionals(c) {
  const mine = new Set(c.schedule.map((s) => s.key));
  const weeks = new Set(c.schedule.filter((s) => s.status === 'pending').map((s) => eventByKey(s.key).week));
  return season().events.filter((e) => e.type === 'regional' && !mine.has(e.key) && !weeks.has(e.week) && eventDay(e.key) > c.day + 2)
    .sort((a, b) => a.week - b.week || a.name.localeCompare(b.name));
}
export function addRegional(c, key) {
  if (c.money < EXTRA_REGIONAL) return false;
  c.money -= EXTRA_REGIONAL;
  c.schedule.push({ key, kind: 'regional', status: 'pending' });
  c.schedule.sort((x, y) => eventDay(x.key) - eventDay(y.key));
  log(c, `報名 ${eventByKey(key).name}（$${EXTRA_REGIONAL}）。`);
  return true;
}

// ---------- Events ----------
const VENUE = { regional: 'regional', district: 'district', district_cmp: 'dcmp', champs_div: 'champs', einstein: 'einstein' };

export function playerBuild(c) {
  const mods = {};
  for (const [sub, h] of Object.entries(c.health)) {
    if (!h.broken || !BREAK[sub]) continue;
    for (const [k, v] of Object.entries(BREAK[sub].mods)) mods[k] = k === 'climbMax' ? Math.min(mods[k] ?? 9, v) : (mods[k] ?? 1) * v;
  }
  return { ...c.build, id: 'career', mods };
}

function lineupTeams(c, nums) {
  const builds = [playerBuild(c)], names = {}, teams = [];
  for (const n of nums) {
    names[n] = n === c.team.number ? c.team.name : teamInfo(n)?.name || '';
    if (n === c.team.number) { teams.push({ number: n, preset: 'custom-career', skill: driverSkill(c), player: true }); continue; }
    const r = teamRobot(n);
    if (r.build) builds.push(r.build);
    teams.push({ number: n, preset: r.preset, skill: r.skill });
  }
  return { teams, names, customs: builds };
}

// A real roster with us in it: our own spot if the team was there, else we take a random team's.
function withMe(c, roster, seedKey) {
  const me = c.team.number;
  if (roster.includes(me)) return [...roster];
  let h = 0;
  for (const ch of seedKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [...roster];
  out[h % out.length] = me;
  return out;
}

// Everything still unbuilt is finished in the pit on load-in day, badly.
function rushUnfinished(c) {
  if (!c.build.adv) return [];
  const rushed = [];
  for (const sub of ORDER) {
    const s = c.subs[sub];
    if (s.done) continue;
    s.done = true; s.quality = 0.45; s.progress = s.need;
    if (!s.installed) {
      for (const [item, q] of Object.entries(s.cots)) c.inventory[item] = Math.max(0, (c.inventory[item] || 0) - q);
      s.installed = { ...s.cots };
    }
    for (const p of Object.values(c.parts)) if (p.sub === sub) { p.way ??= chooseWay(c, p); p.done = partHours(p, p.way); }
    rushed.push(SUBS[sub].name);
  }
  return rushed;
}

export function startEvent(c) {
  const next = nextEvent(c);
  const e = next.event, me = c.team.number;
  c.day = Math.max(c.day, next.day);
  if (!c.build.adv) setDesign(c, { ...c.build, adv: defaultAdvanced() });
  const rushed = rushUnfinished(c);
  if (rushed.length) log(c, `在 pit 趕工完成：${rushed.join('、')}（品質很差，容易壞）。`);
  for (const sub of ORDER) c.health[sub] ??= { wear: 0, broken: false };
  c.pitPts = 4;
  c.seen = [];
  let ev;
  if (next.kind === 'einstein') {
    ev = einstein(c, e);
  } else {
    const roster = withMe(c, e.teams, e.key);
    const { teams, names, customs } = lineupTeams(c, roster);
    const per = roster.length <= 40 ? 10 : roster.length <= 60 ? 9 : 8;
    ev = makeEvent({ teams, me, per, level: e.type === 'champs_div' ? 'champs' : 'regional', title: e.name, names, customs, venue: VENUE[e.type], key: e.key });
  }
  registerBuilds(ev.customs);
  c.stage = 'event';
  c.evKey = e.key;
  log(c, `抵達 ${e.name}。`);
  return ev;
}

// Einstein: the eight real division winners, with our alliance in place of our division's.
function einstein(c, e) {
  const last = c.history[c.history.length - 1];
  const ours = last.allianceTeams;
  const division = eventByKey(last.key).teams;
  const alliances = e.alliances.map((a) => a.map(Number));
  let k = alliances.findIndex((a) => a.some((n) => division.includes(n)));
  if (k < 0) k = 7;
  alliances[k] = ours;
  const nums = alliances.flat();
  const { teams, names, customs } = lineupTeams(c, nums);
  // Our partners keep the robots they had in the division.
  return makePlayoffs({
    teams, me: c.team.number, level: 'champs', title: 'Einstein Field', names, customs, venue: 'einstein', key: e.key,
    alliances: alliances.map((a, i) => (i === k ? ours : a)),
  });
}

// Matches we played that haven't been rolled for damage yet.
export function newMatches(c, ev) {
  const me = c.team.number, out = [];
  for (const m of ev.quals) if (m.result && [...m.red, ...m.blue].includes(me) && !c.seen.includes(m.id)) out.push(m.id);
  for (const [id, m] of Object.entries(ev.po || {})) {
    if (!m.result || c.seen.includes(id)) continue;
    const lu = lineup(ev, id);
    if ([...lu.red, ...lu.blue].includes(me)) out.push(id);
  }
  return out;
}

// After each of our matches: wear, maybe a breakdown, and two more pit actions.
export function afterMatch(c, id) {
  c.seen.push(id);
  c.pitPts += 2;
  const broke = [];
  for (const sub of ORDER) {
    const s = c.subs[sub], h = c.health[sub];
    if (!BREAK[sub] || !s || h.broken || !s.need) continue;
    const q = s.quality ?? 1;
    h.wear = Math.min(1, h.wear + 0.03 + (1 - q) * 0.05);
    const p = (0.01 + (1 - q) * 0.09 + h.wear * 0.1) * (1 - shakedown(c));
    if (Math.random() < p) { h.broken = true; broke.push(sub); }
  }
  if (broke.length) log(c, `${id} 之後：${broke.map((s) => BREAK[s].name).join('、')}！到 pit 修理。`);
  return broke;
}

export const REPAIR = 2, SERVICE = 1;
export function repair(c, sub) {
  const h = c.health[sub];
  if (!h?.broken || c.pitPts < REPAIR) return false;
  c.pitPts -= REPAIR; h.broken = false; h.wear = Math.max(0, h.wear - 0.1);
  log(c, `修好了${SUBS[sub].name}。`);
  return true;
}
export function service(c, sub) {
  const h = c.health[sub];
  if (!h || h.wear <= 0 || c.pitPts < SERVICE) return false;
  c.pitPts -= SERVICE; h.wear = Math.max(0, h.wear - 0.2);
  return true;
}

// Before one of our matches: the robot as it is now and how well our bot driver drives it.
export function prepMatch(c, ev) {
  const pb = playerBuild(c);
  ev.customs[0] = pb;
  registerBuilds([pb]);
  const t = evTeam(ev, c.team.number);
  if (t) t.skill = driverSkill(c);
}

// ---------- Results and qualification ----------
// FRC district points: qualification rank, alliance selection and playoff finish.
function erfinv(x) {
  const a = 0.147, ln = Math.log(1 - x * x), t = 2 / (Math.PI * a) + ln / 2;
  return Math.sign(x) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
}
export function qualPoints(N, R) { return Math.ceil(erfinv((N - 2 * R + 2) / (1.07 * N)) * 10 / erfinv(1 / 1.07) + 12); }
const PLAYOFF_PTS = { 1: 30, 2: 20, 3: 13, 4: 7 };
export function eventPoints(N, rank, k, role, finish) {
  const q = rank ? qualPoints(N, rank) : 0;
  const sel = k === null ? 0 : role === 2 ? k + 1 : 17 - (k + 1);
  return { q, sel, po: PLAYOFF_PTS[finish] || 0, total: q + sel + (PLAYOFF_PTS[finish] || 0) };
}

// What a team of this EPA would typically earn at one district event (for teams we don't simulate).
function estimate(n, pool) {
  const p = pool.indexOf(n) / Math.max(1, pool.length - 1);
  const q = 4 + 18 * p, sel = p > 0.67 ? 1 + 15 * (p - 0.67) / 0.33 : 0, po = p > 0.85 ? 7 + 23 * (p - 0.85) / 0.15 : p > 0.75 ? 4 : 0;
  return q + sel + po;
}

// The finished event's result for us, and what it means for the season.
export function finishEvent(c, ev) {
  const me = c.team.number;
  const ranks = ev.quals.length ? rankings(ev) : [];
  const rank = ranks.findIndex((r) => r.number === me) + 1 || null;
  const k = ev.sel.alliances.findIndex((a) => a.includes(me));
  const role = k >= 0 ? ev.sel.alliances[k].indexOf(me) : null;
  const fin = finishes(ev);
  const finish = k >= 0 ? fin[k] : null;
  const rec = ranks.find((r) => r.number === me);
  const pts = eventPoints(ev.size, rank, k >= 0 ? k : null, role, finish);
  const entry = c.schedule.find((s) => s.key === ev.key && s.status === 'pending');
  const kind = entry?.kind;
  const res = {
    key: ev.key, name: ev.title, kind, rank, N: ev.size, alliance: k >= 0 ? k : null, role, finish,
    record: rec ? `${rec.w}-${rec.l}-${rec.t}` : '', points: pts, allianceTeams: k >= 0 ? ev.sel.alliances[k] : null, notes: [],
  };
  if (entry) entry.status = 'done';
  c.history.push(res);
  c.stage = 'build';
  c.evKey = null;
  // Between events the team fixes everything and half the wear.
  for (const h of Object.values(c.health)) { h.broken = false; h.wear *= 0.5; }
  c.day = Math.max(c.day, eventDay(ev.key) + 3);
  if (finish === 1) { c.money += 2000; res.notes.push('冠軍！贊助商加碼 $2000。'); }

  if (kind === 'district') {
    c.points += pts.total;
    res.notes.push(`拿到 ${pts.total} 點地區積分（排名 ${pts.q}、選聯盟 ${pts.sel}、淘汰賽 ${pts.po}）。`);
    if (c.schedule.filter((s) => s.kind === 'district').every((s) => s.status === 'done')) decideDcmp(c, res);
  } else if (kind === 'dcmp') {
    c.points += pts.total * 3;
    res.notes.push(`地區冠軍賽積分 ×3：${pts.total * 3} 點。`);
    decideChamps(c, res, finish === 1);
  } else if (kind === 'regional') {
    const won = finish === 1;
    // Regional pool (simplified): two more slots per regional by event points, after the winners.
    const others = [];
    for (const r of ranks) {
      if (fin[ev.sel.alliances.findIndex((a) => a.includes(r.number))] === 1) continue;
      const kk = ev.sel.alliances.findIndex((a) => a.includes(r.number));
      others.push({ n: r.number, p: eventPoints(ev.size, ranks.indexOf(r) + 1, kk >= 0 ? kk : null, kk >= 0 ? ev.sel.alliances[kk].indexOf(r.number) : null, kk >= 0 ? fin[kk] : null).total });
    }
    others.sort((a, b) => b.p - a.p);
    const pool = others.slice(0, 2).some((o) => o.n === me);
    if (!c.qualified.champs && (won || pool)) {
      c.qualified.champs = true;
      res.notes.push(won ? '贏得區域賽，拿到休士頓冠軍賽門票！' : '區域賽積分池名額：拿到休士頓冠軍賽門票！');
      addChamps(c);
    } else if (!c.qualified.champs) {
      res.notes.push(`這場沒拿到冠軍賽資格（區域賽積分 ${pts.total}）。`);
      if (!c.schedule.some((s) => s.status === 'pending')) res.notes.push('可以在「賽程」再報名一場之後的區域賽。');
    }
  } else if (kind === 'champs') {
    if (finish === 1) { res.notes.push('分區冠軍！前進 Einstein。'); c.schedule.push({ key: season().events.find((e) => e.type === 'einstein').key, kind: 'einstein', status: 'pending' }); }
    else endSeason(c, finish ? `分區淘汰賽止步（第 ${finish} 名）。` : rank ? `分區資格賽第 ${rank} 名，沒有進淘汰賽。` : '');
  } else if (kind === 'einstein') {
    endSeason(c, finish === 1 ? '🏆 世界冠軍！' : `Einstein 第 ${finish} 名。`);
  }
  if (!c.ended && !c.schedule.some((s) => s.status === 'pending') && kind !== 'regional') endSeason(c, res.notes.length ? '' : '賽季結束。');
  log(c, `${ev.title} 結束：${res.notes.join(' ')}`);
  return res;
}

function districtPool(c) {
  const d = c.district;
  return Object.keys(season().teams).map(Number).filter((n) => n !== c.team.number && teamInfo(n).district === d)
    .sort((a, b) => teamInfo(a).epa - teamInfo(b).epa);
}

function decideDcmp(c, res) {
  const d = c.district;
  const cmps = season().events.filter((e) => e.type === 'district_cmp' && e.district === d && e.teams.length > 8);
  const slots = cmps.reduce((n, e) => n + e.teams.length, 0);
  const pool = districtPool(c);
  const ests = pool.map((n) => 2 * estimate(n, pool)).sort((a, b) => b - a);
  const cut = ests[Math.max(0, slots - 1)] ?? 0;
  res.notes.push(`地區積分 ${c.points}，晉級門檻約 ${Math.round(cut)}（${slots} 個名額）。`);
  if (c.points >= cut && cmps.length) {
    c.qualified.dcmp = true;
    // Divisional championships: go to the one our real team was in, else a random one.
    const pick = cmps.find((e) => e.teams.includes(c.team.number)) || cmps[Math.floor(Math.random() * cmps.length)];
    c.schedule.push({ key: pick.key, kind: 'dcmp', status: 'pending' });
    res.notes.push(`晉級 ${pick.name}！`);
  } else {
    endSeason(c, '地區積分不夠，沒有晉級地區冠軍賽。');
  }
}

function decideChamps(c, res, wonDcmp) {
  const d = c.district, pool = districtPool(c);
  const champsTeams = new Set(season().events.filter((e) => e.type === 'champs_div').flatMap((e) => e.teams));
  const slots = pool.filter((n) => champsTeams.has(n)).length;
  const dcmpSet = new Set(season().events.filter((e) => e.type === 'district_cmp' && e.district === d).flatMap((e) => e.teams));
  const ests = pool.map((n) => estimate(n, pool) * (2 + (dcmpSet.has(n) ? 3 : 0))).sort((a, b) => b - a);
  const cut = ests[Math.max(0, slots - 1)] ?? 0;
  res.notes.push(`總積分 ${c.points}，冠軍賽門檻約 ${Math.round(cut)}（${slots} 個名額）。`);
  if (wonDcmp || c.points >= cut) {
    c.qualified.champs = true;
    res.notes.push(wonDcmp ? '贏得地區冠軍賽，前進休士頓！' : '地區積分夠，前進休士頓！');
    addChamps(c);
  } else endSeason(c, '積分差一點，沒拿到冠軍賽資格。');
}

function addChamps(c) {
  const divs = season().events.filter((e) => e.type === 'champs_div');
  const div = divs.find((e) => e.teams.includes(c.team.number)) || divs[Math.floor(Math.random() * divs.length)];
  c.schedule.push({ key: div.key, kind: 'champs', status: 'pending' });
  // Regional teams: drop regionals after Houston (none in 2026, but keep the season in order).
  c.schedule.sort((x, y) => eventDay(x.key) - eventDay(y.key));
}

function endSeason(c, text) {
  c.ended = text || '賽季結束。';
  c.stage = 'done';
  for (const s of c.schedule) if (s.status === 'pending') s.status = 'skipped';
}

