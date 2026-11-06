import { ROBOT_PRESETS, SCORE } from './config.js';
import { registerBuilds } from './parts.js';

// Events: qualification schedule, rankings, alliance selection and the 8-alliance double-elimination
// playoff. The state is plain JSON kept in localStorage; matches without the player run headless in
// Web Workers (bench/worker.js) while the player drives their own.

const KEY = 'simbotics.event';
export const SIZES = { 24: 8, 32: 9, 40: 9 };   // teams -> qualification matches per team
export const LEVELS = {
  regional: { name: '區域賽', real: 2, skills: { easy: 0.25, medium: 0.4, hard: 0.25, einstein: 0.1 } },
  champs: { name: '冠軍賽', real: 5, skills: { medium: 0.2, hard: 0.45, einstein: 0.35 } },
};
const SKILL_ORDER = ['easy', 'medium', 'hard', 'einstein'];
const GENERIC = ['balanced', 'shuttle', 'hopper'];

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const seed = () => (Math.random() * 2 ** 32) >>> 0;
const sum = (rp) => rp.win + rp.energized + rp.supercharged + rp.traversal;

export function newEvent(size, level, me) {
  const lv = LEVELS[level] || LEVELS.regional;
  const used = new Set([me.number]);
  const teams = [{ number: me.number, preset: me.preset, skill: null, player: true }];
  const real = shuffle(Object.keys(ROBOT_PRESETS).filter((k) => ROBOT_PRESETS[k].real && k !== me.preset && !used.has(ROBOT_PRESETS[k].team)));
  for (const k of real.slice(0, lv.real)) { teams.push({ number: ROBOT_PRESETS[k].team, preset: k, skill: 'einstein' }); used.add(ROBOT_PRESETS[k].team); }
  const weights = Object.entries(lv.skills);
  while (teams.length < size) {
    let n;
    do { n = 1 + Math.floor(Math.random() * 10999); } while (used.has(n));
    used.add(n);
    let u = Math.random(), skill = weights[weights.length - 1][0];
    for (const [k, w] of weights) { if ((u -= w) < 0) { skill = k; break; } }
    teams.push({ number: n, preset: GENERIC[Math.floor(Math.random() * GENERIC.length)], skill });
  }
  teams.sort((a, b) => a.number - b.number);
  const quals = schedule(teams.map((t) => t.number), SIZES[size] || 9)
    .map((m, i) => ({ id: `Q${i + 1}`, red: m.red, blue: m.blue, seed: seed(), result: null }));
  return { v: 1, level, size, me: me.number, teams, quals, phase: 'quals', sel: null, po: null };
}

// Greedy schedule: each match takes the six teams with the fewest matches so far (longest rest first),
// then splits them red/blue to avoid repeat partners and opponents.
function schedule(nums, per) {
  const played = new Map(nums.map((n) => [n, 0])), last = new Map(nums.map((n) => [n, -9]));
  const pair = new Map(), key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const count = (a, b, w) => pair.get(key(a, b) + w) || 0;
  const out = [];
  const total = (nums.length * per) / 6;
  for (let m = 0; m < total; m++) {
    const six = shuffle([...nums]).sort((a, b) => played.get(a) - played.get(b) || last.get(a) - last.get(b)).slice(0, 6);
    let best = null, bestCost = Infinity;
    for (let mask = 0; mask < 64; mask++) {
      const red = six.filter((_, i) => mask >> i & 1);
      if (red.length !== 3 || !(mask & 1)) continue;
      const blue = six.filter((_, i) => !(mask >> i & 1));
      let c = 0;
      for (const side of [red, blue]) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) c += 3 * count(side[i], side[j], 'p');
      for (const a of red) for (const b of blue) c += count(a, b, 'o');
      if (c < bestCost) { bestCost = c; best = [red, blue]; }
    }
    if (Math.random() < 0.5) best.reverse();
    const [red, blue] = best;
    for (const side of [red, blue]) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const k = key(side[i], side[j]) + 'p'; pair.set(k, (pair.get(k) || 0) + 1); }
    for (const a of red) for (const b of blue) { const k = key(a, b) + 'o'; pair.set(k, (pair.get(k) || 0) + 1); }
    for (const n of six) { played.set(n, played.get(n) + 1); last.set(n, m); }
    out.push({ red, blue });
  }
  return out;
}

export const team = (ev, n) => ev.teams.find((t) => t.number === n);
export const teamName = (ev, n) => `${n} ${ROBOT_PRESETS[team(ev, n)?.preset]?.name.replace(/^\d+\s+/, '') ?? ''}`;

// Qualification record and scouting numbers for every team.
export function records(ev) {
  const rec = new Map(ev.teams.map((t) => [t.number, { number: t.number, played: 0, rp: 0, w: 0, l: 0, t: 0, pts: 0, scored: 0, climb: 0, passes: 0 }]));
  for (const m of ev.quals) {
    if (!m.result) continue;
    for (const a of ['red', 'blue']) {
      const mine = m.result[a], theirs = m.result[a === 'red' ? 'blue' : 'red'];
      for (const n of m[a]) {
        const r = rec.get(n);
        r.played++; r.rp += sum(mine.rp); r.pts += mine.total;
        if (mine.total > theirs.total) r.w++; else if (mine.total < theirs.total) r.l++; else r.t++;
      }
    }
    for (const rb of m.result.robots) {
      const r = rec.get(rb.number);
      if (!r) continue;
      r.scored += rb.scored; r.passes += rb.passes; r.climb += SCORE.levels[rb.climb] || 0;
    }
  }
  for (const r of rec.values()) {
    const k = Math.max(1, r.played);
    r.avgRp = r.rp / k; r.avgPts = r.pts / k;
    r.avgScored = r.scored / k; r.avgClimb = r.climb / k; r.avgPasses = r.passes / k;
    // What a captain looks for: FUEL it scores itself, TOWER points, and some credit for feeding.
    r.value = r.avgScored + r.avgClimb + 0.5 * r.avgPasses;
  }
  return rec;
}

export function rankings(ev) {
  return [...records(ev).values()].sort((a, b) => b.avgRp - a.avgRp || b.avgPts - a.avgPts || a.number - b.number);
}

// ---------- Alliance selection ----------
// Round 1 goes 1 -> 8, round 2 goes 8 -> 1. Each alliance's captain is the best-ranked team still
// free when its turn comes, so captains who get picked move everyone below them up.
const ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0];

function startSelection(ev) {
  ev.phase = 'selection';
  ev.sel = { alliances: Array.from({ length: 8 }, () => []), turn: 0, declined: [], pending: null };
  advanceSelection(ev);
}

const assigned = (ev) => new Set(ev.sel.alliances.flat());

export function candidates(ev) {
  const taken = assigned(ev);
  const free = rankings(ev).filter((r) => !taken.has(r.number));
  const ok = free.filter((r) => !ev.sel.declined.includes(r.number));
  return ok.length ? ok : free;
}

function advanceSelection(ev) {
  const s = ev.sel;
  while (s.turn < ORDER.length) {
    const k = ORDER[s.turn], al = s.alliances[k];
    if (!al.length) al.push(rankings(ev).find((r) => !assigned(ev).has(r.number)).number);
    if (al[0] === ev.me) { s.pending = { type: 'pick', k }; return; }
    const pick = [...candidates(ev)].sort((a, b) => b.value - a.value)[0];
    // A team that declined only gets picked again if nobody else is left.
    if (pick.number === ev.me && !s.declined.includes(ev.me)) { s.pending = { type: 'invite', k }; return; }
    al.push(pick.number);
    s.turn++;
  }
  s.pending = null;
  ev.phase = 'playoffs';
  ev.po = {};
}

export function playerPick(ev, n) {
  const s = ev.sel;
  if (s.pending?.type !== 'pick' || !candidates(ev).some((r) => r.number === n)) return;
  s.alliances[s.pending.k].push(n);
  s.turn++;
  s.pending = null;
  advanceSelection(ev);
}

export function playerRespond(ev, accept) {
  const s = ev.sel;
  if (s.pending?.type !== 'invite') return;
  if (accept) { s.alliances[s.pending.k].push(ev.me); s.turn++; }
  else s.declined.push(ev.me);
  s.pending = null;
  advanceSelection(ev);
}

// ---------- Playoffs ----------
// FRC's 8-alliance double-elimination bracket. Sources: A = alliance seed, W/L = winner/loser of a match.
export const BRACKET = [
  ['M1', '勝部 R1', 'A1', 'A8'], ['M2', '勝部 R1', 'A4', 'A5'], ['M3', '勝部 R1', 'A2', 'A7'], ['M4', '勝部 R1', 'A3', 'A6'],
  ['M5', '敗部 R2', 'L1', 'L2'], ['M6', '敗部 R2', 'L3', 'L4'], ['M7', '勝部 R2', 'W1', 'W2'], ['M8', '勝部 R2', 'W3', 'W4'],
  ['M9', '敗部 R3', 'L7', 'W6'], ['M10', '敗部 R3', 'L8', 'W5'], ['M11', '勝部決賽', 'W7', 'W8'], ['M12', '敗部 R4', 'W10', 'W9'],
  ['M13', '敗部決賽', 'L11', 'W12'], ['F1', '總決賽', 'W11', 'W13'], ['F2', '總決賽', 'W11', 'W13'], ['F3', '總決賽', 'W11', 'W13'],
].map(([id, round, red, blue]) => ({ id, round, red, blue }));

// Alliance index (0-7) a source resolves to, or null while it is still undecided.
function source(ev, src) {
  if (src[0] === 'A') return +src.slice(1) - 1;
  const m = ev.po[`M${src.slice(1)}`];
  if (!m?.result) return null;
  return src[0] === 'W' ? m.winner : m.loser;
}

// Playoff ties go to TOWER points, then AUTO points, then the higher seed.
function decide(res, red, blue) {
  const k = (s) => [s.total, s.autoTower + s.teleTower, s.autoFuel + s.autoTower];
  const a = k(res.red), b = k(res.blue);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? [red, blue] : [blue, red];
  return red < blue ? [red, blue] : [blue, red];
}

// Every playoff match with its alliances (null until known) and whether it will be played.
export function playoffs(ev) {
  if (!ev.po) return [];
  const list = BRACKET.map((b) => {
    const rec = ev.po[b.id] || {};
    return { ...b, a: source(ev, b.red), b: source(ev, b.blue), result: rec.result || null, winner: rec.winner, loser: rec.loser, seed: rec.seed };
  });
  const fin = list.filter((m) => m.id[0] === 'F');
  const wins = (al) => fin.filter((m) => m.result && m.winner === al).length;
  let champion = null;
  for (const m of fin) {
    if (m.a === null) continue;
    if (wins(m.a) >= 2) champion = m.a;
    if (wins(m.b) >= 2) champion = m.b;
  }
  // Finals go in order; F3 only if the first two are split.
  fin.forEach((m, i) => { m.skip = champion !== null && !m.result; m.wait = i > 0 && !fin[i - 1].result; });
  return Object.assign(list, { champion });
}

export function lineup(ev, id) {
  if (id[0] === 'Q') { const m = ev.quals.find((q) => q.id === id); return { red: m.red, blue: m.blue }; }
  const m = playoffs(ev).find((p) => p.id === id);
  return { red: ev.sel.alliances[m.a], blue: ev.sel.alliances[m.b] };
}

export function matchSeed(ev, id) {
  if (id[0] === 'Q') return ev.quals.find((q) => q.id === id).seed;
  ev.po[id] ??= {};
  return (ev.po[id].seed ??= seed());
}

// Matches that can be played now: [{ id, mine }].
export function ready(ev) {
  if (ev.phase === 'quals') return ev.quals.filter((m) => !m.result).map((m) => ({ id: m.id, mine: [...m.red, ...m.blue].includes(ev.me) }));
  if (ev.phase !== 'playoffs') return [];
  return playoffs(ev).filter((m) => m.a !== null && m.b !== null && !m.result && !m.skip && !m.wait)
    .map((m) => ({ id: m.id, mine: [...ev.sel.alliances[m.a], ...ev.sel.alliances[m.b]].includes(ev.me) }));
}

// Store a finished match and move the event along. Returns false if it was already recorded.
export function record(ev, id, res, human) {
  const result = {
    human,
    red: pick(res.red), blue: pick(res.blue),
    robots: res.robots.map((r) => ({ number: r.number, scored: r.scored, shots: r.shots, passes: r.passes, intaked: r.intaked, climb: r.climb })),
  };
  if (id[0] === 'Q') {
    const m = ev.quals.find((q) => q.id === id);
    if (!m || m.result) return false;
    m.result = result;
    if (ev.quals.every((q) => q.result)) startSelection(ev);
    return true;
  }
  const m = playoffs(ev).find((p) => p.id === id);
  if (!m || m.result || m.a === null) return false;
  const [winner, loser] = decide(result, m.a, m.b);
  ev.po[id] = { ...ev.po[id], result, winner, loser };
  if (playoffs(ev).champion !== null) ev.phase = 'done';
  return true;
}
const pick = (s) => ({ total: s.total, autoFuel: s.autoFuel, teleFuel: s.teleFuel, autoTower: s.autoTower, teleTower: s.teleTower, rp: s.rp });

// createWorld settings for a match. With `player`, our robot is the human's (or a bot when simulated).
export function matchSettings(ev, id, base) {
  const lu = lineup(ev, id);
  const color = lu.red.includes(ev.me) ? 'red' : lu.blue.includes(ev.me) ? 'blue' : 'red';
  const opp = color === 'red' ? 'blue' : 'red';
  const ours = lu[color].includes(ev.me) ? [ev.me, ...lu[color].filter((n) => n !== ev.me)] : lu[color];
  const t = (n) => { const x = team(ev, n); return { preset: x.preset, number: x.number, skill: x.skill || 'einstein' }; };
  // Each alliance's strategy brain plays at the level of its best robot.
  const brain = (nums) => SKILL_ORDER[Math.max(...nums.map((n) => SKILL_ORDER.indexOf(t(n).skill)))];
  const lead = t(ours[0]);
  return {
    settings: {
      ...base, mode: 'match', alliance: color, preset: lead.preset, team: lead.number,
      allySkill: brain(ours), oppSkill: brain(lu[opp]),
      allyTactic: (lu[color].includes(ev.me) && base.allyTactic) || 'balanced', oppTactic: 'balanced',
      lineup: { ally: ours.slice(1).map(t), opp: lu[opp].map(t) },
      customs: ev.customs || [],
    },
    mine: lu[color].includes(ev.me),
    playerBot: lead.skill,
  };
}

export function load() {
  try { const ev = JSON.parse(localStorage.getItem(KEY) || 'null'); return ev?.v === 1 ? ev : null; } catch { return null; }
}
export function save(ev) {
  try { if (ev) localStorage.setItem(KEY, JSON.stringify(ev)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

// Runs every match the player isn't in on a small worker pool, as soon as it can be played.
export class EventRunner {
  constructor(onChange) {
    this.ev = load();
    if (this.ev?.customs) registerBuilds(this.ev.customs);
    this.onChange = onChange;
    this.busy = new Set();
    this.workers = [];
    this.queue = [];
    const cores = navigator.hardwareConcurrency || 4;
    this.size = Math.max(1, Math.min(matchMedia('(pointer: coarse)').matches ? 2 : 4, cores - 2));
  }

  start(ev) { this.ev = ev; this.busy.clear(); this.queue = []; save(ev); this.pump(); this.onChange(); }
  abandon() { this.ev = null; this.busy.clear(); this.queue = []; save(null); this.onChange(); }

  // simulate: also hand the player's own match to a bot.
  pump(simulate = null) {
    const ev = this.ev;
    if (!ev) return;
    for (const m of ready(ev)) {
      if (this.busy.has(m.id) || (m.mine && m.id !== simulate)) continue;
      const { settings, playerBot } = matchSettings(ev, m.id, {});
      this.busy.add(m.id);
      this.queue.push({ id: m.id, seed: matchSeed(ev, m.id), settings, playerBot, ev });
    }
    save(ev);
    this.dispatch();
  }

  done(id, res, human) {
    this.busy.delete(id);
    if (!this.ev || !record(this.ev, id, res, human)) return;
    save(this.ev);
    this.pump();
    this.onChange();
  }

  dispatch() {
    while (this.workers.length < this.size && this.queue.length > this.workers.filter((w) => !w.job).length) {
      const w = { worker: new Worker(new URL('../bench/worker.js', import.meta.url), { type: 'module' }), job: null, ready: false };
      w.worker.onmessage = (e) => {
        if (e.data.ready) { w.ready = true; this.dispatch(); return; }
        const job = w.job;
        w.job = null;
        if (e.data.error) { console.error(e.data.error); this.busy.delete(job.id); }
        else if (job.ev === this.ev) this.done(job.id, e.data, false);
        this.dispatch();
      };
      this.workers.push(w);
    }
    for (const w of this.workers) {
      if (!w.ready || w.job || !this.queue.length) continue;
      w.job = this.queue.shift();
      if (w.job.ev !== this.ev) { w.job = null; continue; }
      const { ev, ...job } = w.job;
      w.worker.postMessage(job);
    }
  }

  get running() { return this.busy.size; }
}
