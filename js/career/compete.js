import { registerBuilds, compile, advanced, WEIGHT_LIMIT } from '../parts.js';
import { makeEvent, makePlayoffs, rankings, finishes, lineup, ready, record, matchSettings, matchSeed, playoffs, team as evTeam } from '../event.js';
import { season, eventByKey, teamInfo, teamRobot, VENUE, perTeam, rosterWith, shortName } from '../season.js';
import { DAY, SUBS, SUB_ORDER, money } from './data.js';
import { log, mail, robotBuild, drivable } from './state.js';
import { startDay, newTrip } from './trip.js';

// The competition season inside the career: which events we're in, an event's timed schedule
// (matches happen at their time on the clock), other teams' matches run in Web Workers, our robot's
// wear and repairs, batteries, inspection, scouting, and what the results mean for the season.

export const EXTRA_FEE = 4000, CMP_FEE = 5500;
export const KIND = { regional: '區域賽', district: '分區賽', dcmp: '地區冠軍賽', champs: '冠軍賽分組', einstein: 'Einstein' };
export const OPEN = 8 * 60, CLOSE = 19 * 60;   // venue hours

// ---------- The season's schedule ----------
export function register(g, keys, kind) {
  for (const key of keys) {
    if (g.schedule.some((s) => s.key === key)) continue;
    g.schedule.push({ key, kind, status: 'pending' });
    (g.trips ??= {})[key] = newTrip(g, eventByKey(key));
  }
  g.schedule.sort((a, b) => startDay(eventByKey(a.key)) - startDay(eventByKey(b.key)));
}
export const nextEntry = (g) => g.schedule.find((s) => s.status === 'pending' || s.status === 'active');
export const nextEvent = (g) => { const s = nextEntry(g); return s ? eventByKey(s.key) : null; };

// Regionals we could still add: not in a week we're already busy, at least a week out.
export function openRegionals(g) {
  const busyWeeks = new Set(g.schedule.filter((s) => s.status !== 'skipped').map((s) => eventByKey(s.key).week));
  const today = Math.floor(g.t / DAY);
  return season().events.filter((e) => e.type === 'regional' && !busyWeeks.has(e.week) && startDay(e) > today + 7)
    .sort((a, b) => a.week - b.week || a.name.localeCompare(b.name));
}
export function addRegional(g, key) {
  if (g.money < EXTRA_FEE) return false;
  g.money -= EXTRA_FEE; g.stats.spent += EXTRA_FEE;
  register(g, [key], 'regional');
  log(g, `報名 ${shortName(eventByKey(key).name)}（${money(EXTRA_FEE)}）。`);
  return true;
}

// ---------- Building our event ----------
export const ME_PRESET = 'custom-career';
function lineupTeams(g, nums) {
  const builds = [{ ...robotBuild(g), id: 'career' }], names = {}, teams = [];
  for (const n of nums) {
    names[n] = n === g.team.number ? g.team.name : teamInfo(n)?.name || '';
    if (n === g.team.number) { teams.push({ number: n, preset: ME_PRESET, skill: driverSkill(g), player: true }); continue; }
    const r = teamRobot(n);
    if (r.build) builds.push(r.build);
    teams.push({ number: n, preset: r.preset, skill: r.skill });
  }
  return { teams, names, customs: builds };
}

export function startEvent(g, entry) {
  const e = eventByKey(entry.key), me = g.team.number;
  let ev;
  if (entry.kind === 'einstein') ev = einstein(g, e);
  else {
    const roster = rosterWith(e.teams, me, e.key);
    const { teams, names, customs } = lineupTeams(g, roster);
    ev = makeEvent({ teams, me, per: perTeam(roster.length), level: e.type === 'champs_div' ? 'champs' : 'regional', title: shortName(e.name), names, customs, venue: VENUE[e.type], key: e.key });
  }
  registerBuilds(ev.customs);
  const D = entry.kind === 'einstein' ? Math.floor(g.t / DAY) : startDay(e);
  ev.D = D;
  ev.times = {};
  ev.ptimes = {};
  scheduleQuals(ev);
  g.ev = ev;
  g.mine = {};
  g.scout = {};
  g.inspected = entry.kind === 'einstein' || entry.kind === 'champs' ? g.inspected : false;
  g.insp = null;
  g.robotPos = 'pit';
  g.evRoles ??= {};
  entry.status = 'active';
  log(g, `${ev.title}：抵達賽場，開始 load-in。`);
  return ev;
}

// Qualification matches on days 2 and 3 with a lunch break; selection, then playoffs.
function scheduleQuals(ev) {
  const n = ev.quals.length;
  if (!n) { ev.selT = (ev.D) * DAY + 9 * 60; return; }
  const blocks = [[(ev.D + 1) * DAY + 9 * 60, (ev.D + 1) * DAY + 12 * 60], [(ev.D + 1) * DAY + 13 * 60, (ev.D + 1) * DAY + 18 * 60 + 30], [(ev.D + 2) * DAY + 8 * 60 + 30, (ev.D + 2) * DAY + 12 * 60]];
  const avail = blocks.reduce((s, [a, b]) => s + b - a, 0);
  const cyc = Math.max(5, Math.min(12, Math.floor(avail / n)));
  let bi = 0, t = blocks[0][0];
  for (const m of ev.quals) {
    if (t + cyc > blocks[bi][1] && bi < blocks.length - 1) { bi++; t = blocks[bi][0]; }
    ev.times[m.id] = t;
    t += cyc;
  }
  ev.selT = Math.max((ev.D + 2) * DAY + 12 * 60 + 30, t + 20);
}
export const matchTime = (ev, id) => (id[0] === 'Q' ? ev.times[id] : ev.ptimes[id]);
export const ours = (ev, id) => { const lu = lineup(ev, id); return [...lu.red, ...lu.blue].includes(ev.me); };

// Playoff matches get a time when they become playable.
export function timePlayoffs(g) {
  const ev = g.ev;
  if (ev.phase !== 'playoffs') return;
  const start = ev.quals.length ? ev.selT + 50 : ev.D * DAY + 9 * 60 + 30;
  let last = Math.max(start - 12, ...Object.values(ev.ptimes));
  for (const m of ready(ev)) {
    if (ev.ptimes[m.id]) continue;
    last = Math.max(last + 12, g.t + 15);
    ev.ptimes[m.id] = last;
  }
}

// Our own matches, in order, with their times.
export function myMatches(ev) {
  const out = ev.quals.filter((m) => [...m.red, ...m.blue].includes(ev.me)).map((m) => ({ id: m.id, t: ev.times[m.id], result: m.result }));
  for (const m of playoffs(ev)) if (m.a !== null && m.b !== null && ev.ptimes[m.id] && ours(ev, m.id)) out.push({ id: m.id, t: ev.ptimes[m.id], result: m.result });
  return out.sort((a, b) => a.t - b.t);
}
// Our next match still to get ready for (one already started is just waiting for its result).
export function nextMine(g) { return myMatches(g.ev).find((m) => !m.result && !g.mine[m.id]?.done && !g.mine[m.id]?.started); }

// ---------- Background matches on workers, revealed at their time ----------
export class TimedRunner {
  constructor(onResult) {
    this.onResult = onResult;
    this.workers = [];
    this.queue = [];
    this.pending = {};
    this.busy = new Set();
    this.size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
  }
  reset() { this.queue = []; this.pending = {}; this.busy.clear(); }

  // live: the id being shown on the field (we take its result from there).
  pump(g, live, mineDue) {
    const ev = g.ev;
    if (!ev) return;
    timePlayoffs(g);
    for (const m of ready(ev)) {
      const t = matchTime(ev, m.id);
      if (t === undefined || m.id === live) continue;
      const mine = m.mine;
      if (mine && !mineDue?.(m.id)) continue;   // ours: only once we're not going to play it ourselves
      if (!this.busy.has(m.id) && !this.pending[m.id] && g.t >= t - 30) {
        const { settings, playerBot } = matchSettings(ev, m.id, {});
        this.busy.add(m.id);
        this.queue.push({ id: m.id, seed: matchSeed(ev, m.id), settings, playerBot, ev });
      }
      if (this.pending[m.id] && g.t >= t + 4) {
        const res = this.pending[m.id];
        delete this.pending[m.id];
        if (record(ev, m.id, res, false)) this.onResult(m.id, res, mine);
      }
    }
    this.dispatch(ev);
  }

  dispatch(ev) {
    while (this.workers.length < this.size && this.queue.length > this.workers.filter((w) => !w.job).length) {
      const w = { worker: new Worker(new URL('../../bench/worker.js', import.meta.url), { type: 'module' }), job: null, ready: false };
      w.worker.onmessage = (e) => {
        if (e.data.ready) { w.ready = true; this.dispatch(this.ev); return; }
        const job = w.job;
        w.job = null;
        this.busy.delete(job.id);
        if (!e.data.error && job.ev === this.ev) this.pending[job.id] = e.data;
        else if (e.data.error) console.error(e.data.error);
        this.dispatch(this.ev);
      };
      this.workers.push(w);
    }
    this.ev = ev;
    for (const w of this.workers) {
      if (!w.ready || w.job || !this.queue.length) continue;
      w.job = this.queue.shift();
      if (w.job.ev !== ev) { this.busy.delete(w.job.id); w.job = null; continue; }
      const { ev: _e, ...job } = w.job;
      w.worker.postMessage(job);
    }
  }
}

// ---------- Our robot at the event ----------
export const BREAK = {
  frame: { name: '框架變形', mods: { maxSpeed: 0.85, accel: 0.8 }, fix: 90, spare: null },
  drive: { name: 'Swerve 模組故障', mods: { maxSpeed: 0.6, accel: 0.6, maxOmega: 0.6 }, fix: 60, spare: 'swerve' },
  controls: { name: '斷電／CAN 掉線', mods: { maxSpeed: 0.8, fireRate: 0.7 }, fix: 40, spare: 'wiring' },
  intake: { name: 'Intake 卡住', mods: { intakeRate: 0.25 }, fix: 45, spare: 'compliant' },
  hopper: { name: 'Indexer 卡球', mods: { capacity: 0.5, fireRate: 0.7 }, fix: 40, spare: 'belts' },
  shooter: { name: '飛輪皮帶斷', mods: { fireRate: 0.35, spread: 2.5 }, fix: 50, spare: 'belts' },
  climber: { name: '攀爬機構壞', mods: { climbMax: 0 }, fix: 50, spare: 'gearbox' },
};
export const health = (g, sub) => (g.health[sub] ??= { wear: 0, broken: false });

// The robot for our next match: as built, minus broken mechanisms and a tired battery.
export function matchBuild(g) {
  const b = robotBuild(g), mods = { ...b.mods };
  for (const sub of Object.keys(BREAK)) {
    if (!health(g, sub).broken || !g.subs[sub]?.done) continue;
    for (const [k, v] of Object.entries(BREAK[sub].mods)) mods[k] = k === 'climbMax' ? Math.min(mods[k] ?? 9, v) : (mods[k] ?? 1) * v;
  }
  const bat = g.batt?.[g.battIn];
  if (!bat || bat.c < 0.3) { mods.maxSpeed = (mods.maxSpeed ?? 1) * 0.65; mods.fireRate = (mods.fireRate ?? 1) * 0.7; }
  else if (bat.c < 0.6) mods.maxSpeed = (mods.maxSpeed ?? 1) * 0.88;
  return { ...b, id: 'career', mods };
}
export function prepRobot(g) {
  const b = matchBuild(g);
  registerBuilds([b]);
  if (g.ev) { g.ev.customs[0] = b; const t = evTeam(g.ev, g.team.number); if (t) t.skill = driverSkill(g); }
  return compile(b);
}
// A robot that never showed up: it sits still where it was put.
export function noShowBuild(g) {
  const b = { ...robotBuild(g), id: 'career' };
  b.mods = { maxSpeed: 0.001, accel: 0.001, maxOmega: 0.001, fireRate: 0.001, intakeRate: 0.001, climbMax: 0 };
  registerBuilds([b]);
  if (g.ev) g.ev.customs[0] = b;
}

// How well our drivers drive when the bot drives for us: practice hours and the driver's skill.
export function driverSkill(g) {
  const d = g.crew.find((c) => c.id === g.driver) || g.crew.find((c) => c.role === 'drive');
  const h = g.practice * (0.7 + (d ? d.skill * 0.1 : 0.3));
  return h < 8 ? 'easy' : h < 25 ? 'medium' : h < 60 ? 'hard' : 'einstein';
}

// After each of our matches: wear, a chance of breakdown (lower with practice and quality), battery used.
export function afterMatch(g, id) {
  const broke = [];
  const shake = Math.min(0.5, g.practice / 120);
  for (const sub of Object.keys(BREAK)) {
    const s = g.subs[sub];
    if (!s?.done || s.skip) continue;
    const h = health(g, sub), q = s.q ?? 0.8;
    h.wear = Math.min(1, h.wear + 0.03 + (1 - q) * 0.06);
    if (!h.broken && Math.random() < (0.01 + (1 - q) * 0.1 + h.wear * 0.1) * (1 - shake)) { h.broken = true; broke.push(sub); }
  }
  const bat = g.batt?.[g.battIn];
  if (bat) bat.c = Math.max(0, bat.c - 0.45 - Math.random() * 0.15);
  if (broke.length) log(g, `${id} 之後：${broke.map((s) => BREAK[s].name).join('、')}！回 pit 修理。`);
  return broke;
}

// Repair time in minutes: faster with the toolbox and a spare part along.
export function repairPlan(g, sub) {
  const B = BREAK[sub], pack = g.trips[g.ev?.key]?.pack || {};
  const spare = B.spare && (pack[`cots:${B.spare}`] || 0) > 0;
  const tools = pack.toolbox ? 1 : 1.8;
  return { min: Math.round(B.fix * tools * (B.spare && !spare ? 1.6 : 1)), spare, wearAfter: B.spare && !spare ? 0.35 : 0.1 };
}
export function repair(g, sub) {
  const p = repairPlan(g, sub), h = health(g, sub), pack = g.trips[g.ev.key].pack;
  if (p.spare) pack[`cots:${BREAK[sub].spare}`]--;
  h.broken = false; h.wear = p.wearAfter;
  log(g, `修好了${SUBS[sub].name}${p.spare ? '（用掉一個備品）' : ''}。`);
}
export const serviceMin = (g) => ((g.trips[g.ev?.key]?.pack || {}).toolbox ? 20 : 35);
export function service(g, sub) { const h = health(g, sub); h.wear = Math.max(0, h.wear - 0.25); }

// Batteries: one in the robot, the rest on the charger cart.
export function initBatteries(g, n) {
  g.batt = Array.from({ length: Math.max(0, n) }, () => ({ c: 1 }));
  g.battIn = g.batt.length ? 0 : -1;
}
export function chargeBatteries(g, minutes, charger) {
  if (!charger || !g.batt) return;
  // One charger, one battery at a time: the emptiest one that isn't in the robot.
  const list = g.batt.filter((b, i) => i !== g.battIn && b.c < 1).sort((a, b) => a.c - b.c);
  if (list[0]) list[0].c = Math.min(1, list[0].c + minutes / 70);
}
export function swapBattery(g) {
  if (!g.batt?.length) return false;
  let best = -1;
  g.batt.forEach((b, i) => { if (i !== g.battIn && (best < 0 || b.c > g.batt[best].c)) best = i; });
  if (best < 0) return false;
  g.battIn = best;
  return true;
}

// ---------- Inspection ----------
// What the inspector checks. Results depend on the design and how well it was built.
export function inspect(g) {
  const a = g.design?.adv, items = [];
  const w = a ? advanced(a).weight + (1 - avgQ(g)) * 6 + (g.insp?.cut || 0) : 0;
  g.realWeight ??= +(w + (Math.random() - 0.5) * 2).toFixed(1);
  const weight = Math.max(0, g.realWeight - (g.insp?.cut || 0));
  items.push({ key: 'weight', name: `重量 ${weight.toFixed(1)} lb（上限 ${WEIGHT_LIMIT}）`, ok: weight <= WEIGHT_LIMIT, fix: 120, fixName: '減重（鑽減重孔、換輕的零件）' });
  items.push({ key: 'size', name: '周長、高度、伸出限制', ok: !!a && advanced(a).errors.length === 0, fix: 0 });
  const bq = g.subs.bumpers?.done ? g.subs.bumpers.q : 0;
  items.push({ key: 'bumper', name: 'Bumper（號碼、固定、覆蓋）', ok: bq > 0 && (g.insp?.fixed?.bumper || bq > 0.62 || Math.random() < 0.5), fix: 30, fixName: '重新縫 bumper 號碼、加固' });
  const cq = g.subs.controls?.done ? g.subs.controls.q : 0;
  items.push({ key: 'elec', name: '電控（電池固定、主斷路器、線材）', ok: cq > 0 && (g.insp?.fixed?.elec || cq > 0.75 || Math.random() < 0.5), fix: 30, fixName: '把電池綁牢、整理線材' });
  items.push({ key: 'move', name: '機器人能動、能停用', ok: drivable(g), fix: 0 });
  return items;
}
const avgQ = (g) => { const s = SUB_ORDER.map((k) => g.subs[k]).filter((x) => x?.done && !x.skip); return s.length ? s.reduce((a, x) => a + x.q, 0) / s.length : 0.6; };

// ---------- Scouting ----------
// Scouts (or you, watching from the stands) record what each robot did. More data, better guesses.
export function observe(g, res, coverage) {
  for (const r of res.robots) {
    if (r.number === g.team.number || Math.random() > coverage) continue;
    const s = (g.scout[r.number] ??= { n: 0, scored: 0, climb: 0 });
    s.n++; s.scored += r.scored; s.climb += r.climb;
  }
}
export function scoutView(g, n) {
  const s = g.scout[n];
  if (!s?.n) return null;
  return { n: s.n, scored: s.scored / s.n, climb: s.climb / s.n };
}

// ---------- Results and the season ----------
function erfinv(x) {
  const a = 0.147, ln = Math.log(1 - x * x), t = 2 / (Math.PI * a) + ln / 2;
  return Math.sign(x) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
}
const qualPoints = (N, R) => Math.ceil(erfinv((N - 2 * R + 2) / (1.07 * N)) * 10 / erfinv(1 / 1.07) + 12);
const PLAYOFF_PTS = { 1: 30, 2: 20, 3: 13, 4: 7 };
export function eventPoints(N, rank, k, role, finish) {
  const q = rank ? qualPoints(N, rank) : 0;
  const sel = k === null ? 0 : role === 2 ? k + 1 : 17 - (k + 1);
  return { q, sel, po: PLAYOFF_PTS[finish] || 0, total: q + sel + (PLAYOFF_PTS[finish] || 0) };
}
function estimate(n, pool) {
  const p = pool.indexOf(n) / Math.max(1, pool.length - 1);
  const q = 4 + 18 * p, sel = p > 0.67 ? 1 + 15 * (p - 0.67) / 0.33 : 0, po = p > 0.85 ? 7 + 23 * (p - 0.85) / 0.15 : p > 0.75 ? 4 : 0;
  return q + sel + po;
}

export function finishEvent(g) {
  const ev = g.ev, me = g.team.number;
  const ranks = ev.quals.length ? rankings(ev) : [];
  const rank = ranks.findIndex((r) => r.number === me) + 1 || null;
  const k = ev.sel ? ev.sel.alliances.findIndex((a) => a.includes(me)) : -1;
  const role = k >= 0 ? ev.sel.alliances[k].indexOf(me) : null;
  const fin = ev.sel ? finishes(ev) : [];
  const finish = k >= 0 ? fin[k] : null;
  const rec = ranks.find((r) => r.number === me);
  const pts = eventPoints(ev.size, rank, k >= 0 ? k : null, role, finish);
  const entry = g.schedule.find((s) => s.key === ev.key && s.status === 'active');
  if (!entry) return g.history[g.history.length - 1];   // already counted
  const kind = entry.kind;
  const res = { key: ev.key, name: ev.title, kind, rank, N: ev.size, alliance: k >= 0 ? k : null, role, finish, record: rec ? `${rec.w}-${rec.l}-${rec.t}` : '', points: pts, allianceTeams: k >= 0 ? ev.sel.alliances[k] : null, notes: [] };
  if (entry) entry.status = 'done';
  g.history.push(res);
  if (finish === 1) { g.money += 2000; res.notes.push('冠軍！贊助商加碼 $2,000。'); }
  if (kind === 'district') {
    g.points += pts.total;
    res.notes.push(`拿到 ${pts.total} 點地區積分（排名 ${pts.q}、選聯盟 ${pts.sel}、淘汰賽 ${pts.po}）。`);
    if (g.schedule.filter((s) => s.kind === 'district').every((s) => s.status === 'done')) decideDcmp(g, res);
  } else if (kind === 'dcmp') {
    g.points += pts.total * 3;
    res.notes.push(`地區冠軍賽積分 ×3：${pts.total * 3} 點。`);
    decideChamps(g, res, finish === 1);
  } else if (kind === 'regional') {
    const others = [];
    for (const r of ranks) {
      const kk = ev.sel.alliances.findIndex((a) => a.includes(r.number));
      if (kk >= 0 && fin[kk] === 1) continue;
      others.push({ n: r.number, p: eventPoints(ev.size, ranks.indexOf(r) + 1, kk >= 0 ? kk : null, kk >= 0 ? ev.sel.alliances[kk].indexOf(r.number) : null, kk >= 0 ? fin[kk] : null).total });
    }
    others.sort((a, b) => b.p - a.p);
    const pool = others.slice(0, 2).some((o) => o.n === me);
    if (!g.qualified.champs && (finish === 1 || pool)) {
      res.notes.push(finish === 1 ? '贏得區域賽，拿到休士頓冠軍賽門票！' : '區域賽積分池名額：拿到休士頓冠軍賽門票！');
      addChamps(g, res);
    } else if (!g.qualified.champs) res.notes.push(`這場沒拿到冠軍賽資格（區域賽積分 ${pts.total}）。可以在電腦「賽程」加報之後的區域賽。`);
  } else if (kind === 'champs') {
    if (finish === 1) { res.notes.push('分組冠軍！明天前進 Einstein。'); g.schedule.push({ key: season().events.find((e) => e.type === 'einstein').key, kind: 'einstein', status: 'pending' }); }
    else res.notes.push(finish ? `分組淘汰賽止步（第 ${finish} 名）。` : rank ? `分組資格賽第 ${rank} 名。` : '');
  } else if (kind === 'einstein') res.notes.push(finish === 1 ? '🏆 世界冠軍！' : `Einstein 第 ${finish} 名。`);
  log(g, `${ev.title} 結束：${res.notes.join(' ')}`);
  return res;
}

function districtPool(g) {
  return Object.keys(season().teams).map(Number).filter((n) => n !== g.team.number && teamInfo(n).district === g.district).sort((a, b) => teamInfo(a).epa - teamInfo(b).epa);
}
function decideDcmp(g, res) {
  const cmps = season().events.filter((e) => e.type === 'district_cmp' && e.district === g.district && e.teams.length > 8);
  const slots = cmps.reduce((n, e) => n + e.teams.length, 0);
  const pool = districtPool(g), ests = pool.map((n) => 2 * estimate(n, pool)).sort((a, b) => b - a);
  const cut = ests[Math.max(0, slots - 1)] ?? 0;
  res.notes.push(`地區積分 ${g.points}，晉級門檻約 ${Math.round(cut)}（${slots} 個名額）。`);
  if (g.points >= cut && cmps.length) {
    g.qualified.dcmp = true;
    const pick = cmps.find((e) => e.teams.includes(g.team.number)) || cmps[Math.floor(Math.random() * cmps.length)];
    register(g, [pick.key], 'dcmp');
    res.notes.push(`晉級 ${shortName(pick.name)}！`);
    mail(g, 'FIRST', '恭喜晉級地區冠軍賽', `你們晉級了 ${shortName(pick.name)}。記得安排交通和住宿。`);
  } else res.notes.push('地區積分不夠，沒有晉級地區冠軍賽。');
}
function decideChamps(g, res, won) {
  const pool = districtPool(g);
  const champsTeams = new Set(season().events.filter((e) => e.type === 'champs_div').flatMap((e) => e.teams));
  const slots = pool.filter((n) => champsTeams.has(n)).length;
  const dcmpSet = new Set(season().events.filter((e) => e.type === 'district_cmp' && e.district === g.district).flatMap((e) => e.teams));
  const ests = pool.map((n) => estimate(n, pool) * (2 + (dcmpSet.has(n) ? 3 : 0))).sort((a, b) => b - a);
  const cut = ests[Math.max(0, slots - 1)] ?? 0;
  res.notes.push(`總積分 ${g.points}，冠軍賽門檻約 ${Math.round(cut)}（${slots} 個名額）。`);
  if (won || g.points >= cut) { res.notes.push(won ? '贏得地區冠軍賽，前進休士頓！' : '地區積分夠，前進休士頓！'); addChamps(g, res); }
  else res.notes.push('積分差一點，沒拿到冠軍賽資格。');
}
function addChamps(g, res) {
  g.qualified.champs = true;
  const divs = season().events.filter((e) => e.type === 'champs_div');
  const div = divs.find((e) => e.teams.includes(g.team.number)) || divs[Math.floor(Math.random() * divs.length)];
  register(g, [div.key], 'champs');
  g.money -= CMP_FEE; g.stats.spent += CMP_FEE;
  res.notes.push(`冠軍賽報名費 ${money(CMP_FEE)}，分在 ${shortName(div.name)}。`);
  mail(g, 'FIRST', '冠軍賽邀請', `恭喜拿到休士頓冠軍賽資格，你們分在 ${shortName(div.name)}（4/29–5/2）。報名費 ${money(CMP_FEE)} 已扣款。`);
}

// Einstein: the eight real division winners, with our alliance in place of our division's.
function einstein(g, e) {
  const last = g.history[g.history.length - 1], ours = last.allianceTeams;
  const division = eventByKey(last.key).teams;
  const alliances = e.alliances.map((a) => a.map(Number));
  let k = alliances.findIndex((a) => a.some((n) => division.includes(n)));
  if (k < 0) k = 7;
  alliances[k] = ours;
  const { teams, names, customs } = lineupTeams(g, alliances.flat());
  return makePlayoffs({ teams, me: g.team.number, level: 'champs', title: 'Einstein Field', names, customs, venue: 'einstein', key: e.key, alliances });
}

// Is the season over? No events left that we're still going to.
export const seasonOver = (g) => !g.schedule.some((s) => s.status === 'pending' || s.status === 'active');
