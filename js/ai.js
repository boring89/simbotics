import { HL, HW, HUB_X, HUB_HALF, ZONE_X, LANES, TRENCH, TRENCH_LANES, SCORE, side, other } from './config.js';
import { inZone } from './field.js';

// Alliance strategy, modelled on what top 2026 alliances did:
// stockpile while your HUB is inactive and line up to dump at the switch, feed / counter-feed
// FUEL from the neutral zone into your own zone, hold the BUMP/TRENCH lanes against
// opponents coming home, counter-defend, raid the opponent zone to starve them, and swipe
// the neutral zone in AUTO without crossing the centre line.

export const TACTICS = {
  balanced: '均衡（依情況分配）',
  offense: '全力進攻',
  feeder: '供球（專職傳球）',
  defense: '防守（專職防守）',
  starve: '斷糧（搶球、反供球）',
};

export const ROLE_LABEL = {
  auto: 'AUTO', score: '得分', stockpile: '囤球', stage: '就位', feed: '供球',
  defend: '防守', counter: '反防守', raid: '搶球', climb: '攀爬', simple: '收球/得分',
};

const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
// Behaviour switches and tunable numbers (bench/ searches over these). Each alliance's brain
// takes a copy, so one side can run different values; F points at the copy of whichever brain
// or bot is thinking right now.
export const AI_DEFAULTS = {
  exitCatch: true, zoneCamp: true, fixedMove: true, campDepth: 9, loopWait: false,
  bumpLoop: true,     // 254-style BUMP loop for fixed shooters (beats the plain cycle head-to-head)
  fireDepth: 1.2,     // fixed shooters fire this far inside the zone line (m)
  autoReach: -1.5,    // AUTO sweeps up to here, alliance-local x (negative = past centre)
  bumpCost: 1.5,      // extra metres charged for a BUMP lane by robots that fit the TRENCH
  homeScore: 2, homeOther: 0.3,   // how much distance from home counts when picking FUEL
  nbr: 0.5,           // weight of neighbouring cells in a cluster
  mateMul: 0.4,       // cluster value when a teammate is already headed there
  crossCost: 1.5,     // extra metres for a cluster across a HUB line
  pickOverhead: 1.2,  // fixed seconds added to every pickup trip
  wallMul: 0.55, cornerMul: 0.25, // value of FUEL against a wall / in a corner
  retFull: 0.85,      // go home at this fraction of capacity
  retSlack: 2.5,      // seconds of margin to fire the load before our HUB switches off
  retLoad: 10, retFar: 2.5,       // go home with retLoad+ when nothing is within retFar m
  autoFull: 0.8,      // AUTO: go home at this fraction of capacity
  loopFull: 0.85, loopSlack: 2, loopFar: 3, loopFarLoad: 0.5, // BUMP-loop return rules
  catchLoad: 1.2,     // exit-catch when holding at most this many seconds of fire
  catchMin: 4,        // FUEL queued in our HUB before going to catch it
  passKeep: 0.5,      // stockpilers keep this fraction of capacity and pass the rest
  sweepPlan: true,    // elite bots plan straight runs through the FUEL (sweepLine)
  planFixed: false, planRound: true, // ...also for fixed shooters / round chassis
  roundWidth: 0.6,    // a round chassis shoves FUEL aside: credit runs with less of the intake
  loopNearHub: true,  // BUMP loop scoops around our HUB before the rest of our half
  cornerLoop: true,   // fixed shooters run the corner loop (below) instead of the BUMP loop
  cornerDepth: 2.4, cornerZ: 2.9, // its firing spot: this far into our zone, this far off centre
  cornerFull: 0.7,    // ...and the load it heads home with
};
globalThis.AIFLAGS ??= { ...AI_DEFAULTS };
let F = globalThis.AIFLAGS;

// Coarse count of loose FUEL on the carpet, shared by every bot and refreshed a few times a second.
const CELL = 0.6;
const NX = Math.ceil((HL * 2) / CELL), NZ = Math.ceil((HW * 2) / CELL);
function fuelMap(world) {
  const m = world.match;
  let fm = world.fuelMap;
  if (fm && m.t - fm.t < 0.2 && m.t >= fm.t) return fm;
  if (!fm) fm = world.fuelMap = { t: 0, n: new Uint16Array(NX * NZ) };
  fm.t = m.t;
  fm.n.fill(0);
  const f = world.fuel;
  for (let i = 0; i < f.n; i++) {
    if (!f.active[i] || f.py[i] > 0.25 || f.shooter[i] >= 0) continue;
    const cx = Math.min(NX - 1, Math.max(0, Math.floor((f.px[i] + HL) / CELL)));
    const cz = Math.min(NZ - 1, Math.max(0, Math.floor((f.pz[i] + HW) / CELL)));
    fm.n[cx * NZ + cz]++;
  }
  return fm;
}
const FLIGHT = 1.0;   // rough shot flight time used for pre-shooting at a shift change

// Rough scoring power, used to decide who defends or feeds.
export function power(r) {
  const p = r.p;
  return Math.min(p.capacity, 70) * 0.5 + p.fireRate * 2 + p.maxSpeed * 3 - p.spread * 120;
}

export class TeamBrain {
  constructor(world, alliance, tactic, skill, params = null) {
    this.P = { ...AI_DEFAULTS, ...globalThis.AIFLAGS, ...params };
    this.w = world;
    this.a = alliance;
    this.tactic = tactic;
    this.skill = skill;
    this.lvl = skill.tactics;
    this.timer = 0;
    this.ctx = { myOn: true, oppOn: true, toggle: null, remaining: 0, endgame: false };
    this.counterTarget = null;
    this.outpostUser = null;
  }

  bots() { return this.w.bots.filter((b) => b.r.alliance === this.a); }

  // Fixed shooters running the BUMP loop each get their own firing spot, so two or three of
  // them don't pile onto one BUMP: one per BUMP, a third at our far TRENCH exit (or squeezed
  // onto a BUMP when it can't fit the TRENCH). Re-dealt only when the set of loopers changes.
  laneFor(bot) {
    const L = this.bots().filter((b) => b.r.fixedShooter && b.lvl >= 2 && (F.bumpLoop || F.cornerLoop));
    const key = L.map((b) => b.r.id).sort().join(',');
    if (key !== this.laneKey) {
      this.laneKey = key;
      this.lanes = new Map();
      const s = side(this.a);
      let spots = [[-1.65], [-1.65, 1.65], [-1.65, 1.65, s * 3.37]][Math.min(L.length, 3) - 1] || [];
      if (L.length === 1) spots = [(L[0].r.z >= 0 ? 1 : -1) * 1.65];
      if (L.length >= 3 && !L.every((b) => b.r.p.fitsTrench)) spots = [-s * 1.65, s * 1.1, s * 2.25];
      spots.sort((x, y) => x - y);
      // Hand out spots across the field in the order the robots stand.
      [...L].sort((x, y) => x.r.z - y.r.z).forEach((b, i) => this.lanes.set(b, spots[Math.min(i, spots.length - 1)]));
      this.laneList = [...this.lanes.values()];
    }
    return this.lanes.get(bot) ?? (bot.r.z >= 0 ? 1 : -1) * 1.65;
  }

  // The looper whose firing spot is closest to z owns FUEL scattered there.
  laneOwns(bot, z) {
    const mine = this.laneFor(bot);
    return this.laneList.every((l) => Math.abs(z - mine) <= Math.abs(z - l));
  }
  members() { return this.w.robots.filter((r) => r.alliance === this.a); }
  opponents() { return this.w.robots.filter((r) => r.alliance !== this.a); }

  update(dt) {
    F = this.P;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const m = this.w.match, a = this.a;
    const c = this.ctx;
    c.myOn = m.hubActive(a);
    c.oppOn = m.hubActive(other(a));
    c.toggle = m.nextToggle(a);
    c.endgame = m.phase === 'teleop' && m.segment().idx === 5;
    c.remaining = m.phase === 'auto' ? m.autoEnd - m.t : m.matchEnd - m.t;
    this.assign();
  }

  neutralSupply() {
    const f = this.w.fuel;
    let n = 0;
    for (let i = 0; i < f.n; i++) if (f.active[i] && Math.abs(f.px[i]) < HUB_X - 0.6) n++;
    return n;
  }

  // An opponent actually defending: a bot in a defensive role, or anyone (the player) who has
  // been bumping one of our loaded robots near our zone.
  enemyDefender() {
    let best = null, bd = 2.0;
    for (const o of this.opponents()) {
      if (o.climbing || inZone(o.alliance, o.x)) continue;
      const bot = this.w.bots.find((b) => b.r === o);
      const defending = bot ? bot.role === 'defend' : o.contactT > 0 && o.fuel < 5;
      if (!defending) continue;
      for (const r of this.members()) {
        const d = Math.hypot(o.x - r.x, o.z - r.z);
        if (d < bd && r.fuel > 0) { bd = d; best = o; }
      }
    }
    return best;
  }

  assign() {
    const bots = this.bots();
    if (!bots.length) return;
    const m = this.w.match, c = this.ctx, lvl = this.lvl, tac = this.tactic;
    const roles = new Map();
    if (m.phase !== 'teleop' || m.mode === 'practice') {
      for (const b of bots) roles.set(b, m.mode === 'practice' ? 'score' : 'auto');
      for (const [b, role] of roles) b.setRole(role);
      return;
    }
    const sorted = [...bots].sort((x, y) => power(x.r) - power(y.r));
    const weak = sorted[0], mid = sorted.length > 2 ? sorted[1] : null;

    if (c.myOn) {
      for (const b of bots) roles.set(b, 'score');
      if (tac === 'feeder' && lvl >= 1 && bots.length > 1) roles.set(weak, 'feed');
      if (lvl >= 3 && tac !== 'offense') {
        this.counterTarget = this.enemyDefender();
        if (this.counterTarget && bots.length > 1) roles.set(tac === 'feeder' && mid ? mid : weak, 'counter');
      }
    } else {
      for (const b of bots) roles.set(b, 'stockpile');
      if (lvl >= 2) {
        if (tac === 'balanced') { roles.set(weak, 'defend'); if (lvl >= 3 && mid) roles.set(mid, 'feed'); }
        if (tac === 'defense') roles.set(weak, 'defend');
        if (tac === 'feeder') roles.set(weak, 'feed');
        if (tac === 'starve') { roles.set(weak, 'raid'); if (mid) roles.set(mid, 'feed'); }
      }
    }
    // A dedicated defender keeps defending, even through its own shift, except in endgame.
    if (tac === 'defense' && lvl >= 1 && !c.endgame && bots.length > 1) roles.set(weak, 'defend');

    // Come home and line up before the HUB switches on.
    for (const [b, role] of roles) {
      if (c.myOn || c.toggle === null) continue;
      const travel = b.travelToZone();
      // Below Einstein level a full robot parks and waits; elite robots keep feeding the overflow.
      const full = b.r.fuel >= b.r.p.capacity * 0.95 && lvl < 3;
      if (role === 'stockpile' && (c.toggle < travel + 1.5 || full)) roles.set(b, 'stage');
      else if ((role === 'feed' || role === 'raid' || (role === 'defend' && tac !== 'defense')) && lvl >= 3 && c.toggle < travel + 0.8) roles.set(b, 'stage');
    }

    // Elite stockpilers pull from the OUTPOST while the human player has stock.
    this.outpostUser = null;
    const out = this.w.field.outposts[this.a];
    // ...but only once the neutral zone runs dry: the chute is slower than sweeping the carpet.
    if (lvl >= 3 && !c.myOn && out.stock >= 6 && this.neutralSupply() < 50) {
      let bd = Infinity;
      for (const [b, role] of roles) {
        if (role !== 'stockpile') continue;
        const d = Math.hypot(b.r.x - out.mouth.x, b.r.z - out.mouth.z);
        if (d < bd) { bd = d; this.outpostUser = b; }
      }
    }

    if (lvl === 0) for (const b of bots) roles.set(b, 'simple');
    for (const b of bots) if (b.wantsClimb(c)) roles.set(b, 'climb');
    for (const [b, role] of roles) b.setRole(role);
  }
}

export class Bot {
  constructor(robot, world, skill, slot, brain) {
    this.r = robot;
    this.w = world;
    this.skill = skill;
    this.lvl = skill.tactics;
    this.slot = slot;                    // 0..2, spreads bots across the field
    this.brain = brain;
    this.role = 'auto';
    this.mode = 'collect';               // collect / go for the simple fallback logic
    this.ball = -1;
    this.retarget = 0;
    this.path = [];
    this.pathGoal = null;
    this.stuckT = 0;
    this.backT = 0;
    this.backDir = [0, 0];
    this.climbGoal = Math.min(skill.climb, robot.p.climbMax);
    this.ballSince = 0;
    this.blacklist = new Map();          // ball index -> match time it may be targeted again
    this.cellBan = new Map();            // fuel-map cell -> match time it may be swept again
    this.sweepGoal = null;
    this.region = null;
  }

  get state() { return this.role; }

  setRole(role) {
    if (role === this.role) return;
    this.role = role;
    this.homeWeight = role === 'score' ? F.homeScore : F.homeOther;
    this.catching = false;
    this.loop = null;
    this.sweepGoal = null;
    this.run = null;
    this.ball = -1;
    this.retarget = 0;
    this.r.passTarget = null;
  }

  lanes() {
    return this.r.p.fitsTrench ? LANES : LANES.filter((z) => !TRENCH_LANES.includes(z));
  }

  // Seconds to get back inside our own alliance zone.
  travelToZone() {
    const r = this.r, s = side(r.alliance);
    if (inZone(r.alliance, r.x)) return 0;
    const d = Math.max(0, s * (ZONE_X + 0.4) - s * r.x) + 1;
    return d / (r.p.maxSpeed * this.skill.speed * 0.8);
  }

  wantsClimb(ctx) {
    const r = this.r, m = this.w.match;
    if (m.mode !== 'match' || this.climbGoal <= 0) return false;
    // Once committed, stay committed (travel time shrinks as we close in).
    if (this.role === 'climb' && ctx.endgame) return true;
    const tower = this.w.towers[r.alliance];
    const climbTime = (tower.rungs[this.climbGoal - 1] - 0.48) / r.p.climbRate;
    const travel = Math.hypot(tower.climbX - r.x, tower.z - r.z) / (r.p.maxSpeed * this.skill.speed) + 2;
    const leave = climbTime + travel + (this.lvl >= 2 ? 1.0 : 2);
    if (ctx.remaining >= leave) return false;
    if (this.lvl < 2) return true;
    // Decide around the moment we'd have to leave; any later and we'd hang too late to count.
    if (ctx.remaining < leave - 1.5) return false;
    // Elite bots compare the climb with what they'd still score down here in the time left:
    // the load they carry, plus whatever another collect cycle (~4 s) would add at their
    // match rate (both HUBs are live in endgame). Turrets keep firing on the way to the TOWER.
    const rate = r.stats.scored / Math.max(30, m.t - m.countdownEnd) * 1.4;
    const stay = r.fuel + rate * Math.max(0, ctx.remaining - 4);
    const climb = SCORE.levels[this.climbGoal] + (r.fixedShooter ? 0 : r.fuel);
    return climb >= stay;
  }

  // Waypoints that cross HUB lines only through BUMP or TRENCH lanes.
  plan(tx, tz) {
    const r = this.r;
    const pts = [];
    let cx = r.x, cz = r.z;
    const lines = [-HUB_X, HUB_X].filter((h) => (cx - h) * (tx - h) < 0 || Math.abs(cx - h) < 0.7 && Math.abs(tx - h) > 0.7);
    lines.sort((a, b) => Math.abs(a - cx) - Math.abs(b - cx));
    for (const h of lines) {
      const dir = Math.sign(tx - h) || 1;
      const zMid = (cz + tz) / 2;
      // Pick the closest lane, but route around one an opponent is sitting in. Robots that fit
      // can prefer the flat TRENCH over climbing a BUMP (bumpCost, in metres of detour).
      const bumpCost = this.lvl >= 2 && r.p.fitsTrench ? F.bumpCost : 0;
      const blocked = (l) => this.lvl >= 2 && this.w.robots.some((o) => o.alliance !== r.alliance && !o.climbing
        && Math.abs(o.z - l) < 0.9 && Math.abs(o.x - h) < 1.4);
      let lane = null, bestC = Infinity;
      for (const l of this.lanes()) {
        const c = Math.abs(l - zMid) + (blocked(l) ? 3 : 0) + (TRENCH_LANES.includes(l) ? 0 : bumpCost);
        if (c < bestC) { bestC = c; lane = l; }
      }
      // Skip the approach/exit waypoint when we're already (or will end up) right on the BUMP.
      if (Math.abs(cx - h) >= 0.95 || Math.abs(cz - lane) > 0.5) pts.push([h - dir * 0.95, lane]);
      const exitX = Math.abs(tx - h) < 0.95 && Math.sign(tx - h) === dir ? tx : h + dir * 0.95;
      pts.push([exitX, lane]);
      cx = exitX; cz = lane;
    }
    pts.push([tx, tz]);
    this.path = pts;
    this.pathGoal = [tx, tz];
  }

  // Returns [mx, mz, remaining path length].
  goTo(tx, tz, opts = {}) {
    this.replanT = (this.replanT ?? 0) - 1;
    if (!this.pathGoal || !this.path.length || Math.hypot(this.pathGoal[0] - tx, this.pathGoal[1] - tz) > 0.5 || (this.lvl >= 2 && this.replanT <= 0 && this.path.length > 1)) {
      this.replanT = 60;
      this.plan(tx, tz);
    } else {
      this.pathGoal = [tx, tz];
      this.path[this.path.length - 1] = [tx, tz];
    }
    const r = this.r;
    while (this.path.length > 1 && Math.hypot(this.path[0][0] - r.x, this.path[0][1] - r.z) < 0.6) this.path.shift();
    const [wx, wz] = this.path[0];
    let dx = wx - r.x, dz = wz - r.z;
    const d = Math.hypot(dx, dz);
    const last = this.path.length === 1;
    const speed = last && !opts.ram && !opts.through ? Math.min(1, d / 1.2) : 1;
    if (d < 1e-3) return [0, 0, 0];
    dx /= d; dz /= d;

    // Steer around robots (except the one we mean to hit) and the HUBs.
    let ax = 0, az = 0;
    for (const o of this.w.robots) {
      if (o === r || o.climbing || o === opts.ram) continue;
      const ox = r.x - o.x, oz = r.z - o.z, od = Math.hypot(ox, oz);
      if (od < 1.5 && od > 1e-3) {
        const ahead = -(ox * dx + oz * dz) / od;
        if (ahead > -0.2) { const k = (1.5 - od) / 1.5; ax += (ox / od) * k * 1.4; az += (oz / od) * k * 1.4; }
      }
    }
    const rr = Math.max(r.p.halfL, r.p.halfW);
    for (const o of this.w.field.boxes) {
      if (o.kind !== 'hub' && o.kind !== 'trench-block') continue;
      const ox = r.x - o.x, oz = r.z - o.z;
      const ex = Math.max(0, Math.abs(ox) - o.hx), ez = Math.max(0, Math.abs(oz) - o.hz);
      const ed = Math.hypot(ex, ez) - rr;
      if (ed < 0.3) { const k = (0.3 - Math.max(0, ed)) / 0.3; ax += Math.sign(ox) * (ex > 0 ? 1 : 0) * k * 1.5; az += Math.sign(oz) * (ez > 0 ? 1 : 0) * k * 1.5; }
    }
    const mx = dx + ax, mz = dz + az;
    const n = Math.hypot(mx, mz) || 1;
    let rest = d;
    for (let k = 1; k < this.path.length; k++) rest += Math.hypot(this.path[k][0] - this.path[k - 1][0], this.path[k][1] - this.path[k - 1][1]);
    return [(mx / n) * speed, (mz / n) * speed, rest];
  }

  // Higher levels: pick the patch of carpet with the most FUEL per second of driving
  // (including the trip home), then the nearest ball in it.
  pickCluster(allow, bias, homeWeight) {
    const r = this.r, s = side(r.alliance);
    const fm = fuelMap(this.w);
    const v = r.p.maxSpeed * this.skill.speed;
    const mates = this.w.bots.filter((b) => b !== this && b.r.alliance === r.alliance && b.goalCell);
    let best = null, bv = 0;
    for (let cx = 0; cx < NX; cx++) {
      for (let cz = 0; cz < NZ; cz++) {
        let n = fm.n[cx * NZ + cz];
        if (n === 0) continue;
        const x = -HL + (cx + 0.5) * CELL, z = -HW + (cz + 0.5) * CELL;
        if (allow && !allow(x, z)) continue;
        if (Math.abs(z) > TRENCH.zMin && Math.abs(Math.abs(x) - HUB_X) < 0.7 && !r.p.fitsTrench) continue;
        // Neighbouring cells count half: we sweep through a patch, not a single cell.
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ax = cx + dx, az = cz + dz;
          if (ax >= 0 && ax < NX && az >= 0 && az < NZ) n += fm.n[ax * NZ + az] * F.nbr;
        }
        for (const mb of mates) if (Math.abs(mb.goalCell[0] - cx) <= 1 && Math.abs(mb.goalCell[1] - cz) <= 1) n *= F.mateMul;
        let d = Math.hypot(x - r.x, z - r.z);
        if ((Math.abs(r.x) - HUB_X) * (Math.abs(x) - HUB_X) < 0) d += F.crossCost;
        if (bias) d += bias(x, z);
        const home = Math.max(0, s * (ZONE_X + 0.4) - s * x);
        const time = Math.max(0, d) / v + home * homeWeight / v + F.pickOverhead;
        let val = Math.min(n, r.p.capacity - r.fuel + 4) / time;
        // FUEL pinned against a wall or in a corner gets shoved along instead of picked up.
        const wallX = Math.abs(x) > HL - 0.5, wallZ = Math.abs(z) > HW - 0.4;
        if (wallX && wallZ) val *= F.cornerMul; else if (wallX || wallZ) val *= F.wallMul;
        if (val > bv) { bv = val; best = [cx, cz, x, z]; }
      }
    }
    this.goalCell = best;
    return best;
  }

  // Pick a ball to chase. allow(x, z) limits where; dense clusters are preferred at higher levels.
  pickBall(allow, bias) {
    const f = this.w.fuel, r = this.r, s = side(r.alliance);
    const mates = this.w.bots.filter((b) => b !== this && b.r.alliance === r.alliance && b.ball >= 0);
    const now = this.w.match.t;
    const prev = this.ball;
    const cand = [];
    let cell = this.lvl >= 2 ? this.pickCluster(allow, bias, this.homeWeight ?? 0.5) : null;
    for (let pass = 0; pass < 2 && !cand.length; pass++, cell = null) for (let i = 0; i < f.n; i++) {
      if (!f.active[i] || f.py[i] > 0.25 || f.shooter[i] >= 0) continue;
      if ((this.blacklist.get(i) ?? 0) > now) continue;
      const x = f.px[i], z = f.pz[i];
      if (allow && !allow(x, z)) continue;
      // Stay within the chosen patch.
      if (cell && (Math.abs(x - cell[2]) > CELL * 1.6 || Math.abs(z - cell[3]) > CELL * 1.6)) continue;
      const underTrench = Math.abs(z) > TRENCH.zMin && Math.abs(Math.abs(x) - HUB_X) < 0.55;
      if (underTrench && !r.p.fitsTrench) continue;
      let cost = Math.hypot(x - r.x, z - r.z);
      if (Math.abs(x) > HL - 0.3 || Math.abs(z) > HW - 0.2) cost += 3;
      if (Math.abs(Math.abs(x) - HUB_X) < 0.75 && Math.abs(z) < 0.8) cost += 20;
      // Crossing a HUB line costs a detour.
      if ((Math.abs(r.x) - HUB_X) * (Math.abs(x) - HUB_X) < 0 || Math.sign(r.x) !== Math.sign(x) && Math.abs(x) > HUB_X) cost += 1.5;
      if (bias) cost += bias(x, z);
      for (const m of mates) {
        if (Math.hypot(f.px[m.ball] - x, f.pz[m.ball] - z) < 1.2) cost += 2;
      }
      cost += Math.abs(z - s * (this.slot - 1) * 2.2) * (this.lvl >= 3 ? 0.1 : 0.25);
      if (i === prev) cost -= 0.6;
      cand.push(cost, i);
    }
    let best = -1, bestCost = Infinity;
    if (this.lvl >= 2 && !cell && cand.length > 2) {
      // Look at the closest few and favour the ones sitting in a pile.
      const idx = [];
      for (let k = 0; k < cand.length; k += 2) idx.push(k);
      idx.sort((a, b) => cand[a] - cand[b]);
      for (const k of idx.slice(0, 20)) {
        const i = cand[k + 1];
        let n = 0;
        f.query(f.px[i] - 0.45, f.pz[i] - 0.45, f.px[i] + 0.45, f.pz[i] + 0.45, (j) => { if (f.py[j] < 0.25) n++; });
        const c = cand[k] - 0.3 * Math.min(n, 10);
        if (c < bestCost) { bestCost = c; best = i; }
      }
    } else {
      for (let k = 0; k < cand.length; k += 2) if (cand[k] < bestCost) { bestCost = cand[k]; best = cand[k + 1]; }
    }
    if (best !== prev) this.ballSince = now;
    this.ball = best;
  }

  // Weighted centre of the loose FUEL around a chosen patch.
  centroid(c, allow) {
    const f = this.w.fuel;
    let sx = 0, sz = 0, n = 0;
    f.query(c[2] - CELL * 1.5, c[3] - CELL * 1.5, c[2] + CELL * 1.5, c[3] + CELL * 1.5, (i) => {
      if (!f.active[i] || f.py[i] > 0.25 || f.shooter[i] >= 0) return;
      if (allow && !allow(f.px[i], f.pz[i])) return;
      sx += f.px[i]; sz += f.pz[i]; n++;
    });
    return n ? [sx / n, sz / n] : null;
  }

  sweep(cmd, dt, allow, bias) {
    // Planned runs pay off for turret robots (a round one with a narrower credited intake, as it
    // shoves FUEL aside); fixed shooters did worse with them in the benchmark.
    if (F.sweepPlan && this.lvl >= 3 && (F.planFixed || !this.r.fixedShooter) && (F.planRound || !this.r.round)) {
      const mv = this.sweepLine(cmd, dt, allow, bias);
      if (mv) return mv;
    }
    return this.sweepCluster(cmd, dt, allow, bias);
  }

  // Elite bots plan a straight run through the FUEL instead: from a fan of lines out of where
  // we are (plus lines aimed through the best clusters), take the one that picks up the most
  // per second, then drive it flat out with the intake leading, the way a driver ploughs a pile.
  sweepLine(cmd, dt, allow, bias) {
    const r = this.r, m = this.w.match;
    cmd.intake = true;
    if (r.stats.intaked !== this.lastIntaked) { this.lastIntaked = r.stats.intaked; this.lastIntakeT = m.t; }
    let run = this.run;
    const stale = run && (Math.hypot(run.x1 - r.x, run.z1 - r.z) < 0.4 || m.t - run.t0 > run.T + 1.5
      || (m.t - run.t0 > 1.2 && m.t - (this.lastIntakeT ?? 0) > 1.2));
    if (stale) run = this.run = null;
    this.runT = (this.runT ?? 0) - dt;
    if (!run || this.runT <= 0) {
      this.runT = 0.35 + this.skill.reaction;
      const best = this.planRun(allow, bias);
      // Stick with the current run unless a clearly better one turns up.
      const cur = run ? this.rateRun(r.x, r.z, run.x1, run.z1, allow, bias) : null;
      if (best && (!cur || best.val > cur.val * 1.3)) this.run = run = { ...best, t0: m.t };
    }
    if (!run) return null;
    this.sweepGoal = [run.x1, run.z1];
    cmd.heading = Math.atan2(-(run.z1 - r.z), run.x1 - r.x);
    return this.goTo(run.x1, run.z1, { through: true });
  }

  planRun(allow, bias) {
    const r = this.r, s = side(r.alliance);
    const dirs = [];
    for (let k = 0; k < 16; k++) dirs.push((k * Math.PI) / 8);
    // Lines through the best few clusters, so a dense pile a little off the fan isn't missed.
    const c = this.pickCluster(allow, bias, this.homeWeight ?? 0.5);
    if (c) dirs.push(Math.atan2(-(c[3] - r.z), c[2] - r.x));
    let best = null;
    for (const a of dirs) {
      const ux = Math.cos(a), uz = -Math.sin(a);
      for (const L of [1.5, 3, 4.5]) {
        let x1 = r.x + ux * L, z1 = r.z + uz * L;
        const lim = r.p.halfL + 0.05;
        x1 = Math.max(-HL + lim, Math.min(HL - lim, x1));
        z1 = Math.max(-HW + lim, Math.min(HW - lim, z1));
        if (!this.runClear(r.x, r.z, x1, z1)) continue;
        const v = this.rateRun(r.x, r.z, x1, z1, allow, bias);
        if (v && (!best || v.val > best.val)) best = v;
      }
    }
    // Spread out: a run ending where a teammate's run ends is worth less.
    if (best) for (const b of this.brain.bots()) {
      if (b !== this && b.run && Math.hypot(b.run.x1 - best.x1, b.run.z1 - best.z1) < 1.0) best.val *= F.mateMul;
    }
    return best && best.n >= 2 ? best : null;
  }

  // FUEL a run would pick up (what lies in the intake's path), and the rate per second.
  rateRun(x0, z0, x1, z1, allow, bias) {
    const r = this.r, f = this.w.fuel, s = side(r.alliance);
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 0.3) return null;
    const ux = dx / L, uz = dz / L, w = (r.p.intakeW + 0.06) * (r.round ? F.roundWidth : 1);
    let n = 0;
    f.query(Math.min(x0, x1) - w, Math.min(z0, z1) - w, Math.max(x0, x1) + w, Math.max(z0, z1) + w, (i) => {
      if (!f.active[i] || f.py[i] > 0.25 || f.shooter[i] >= 0) return;
      const rx = f.px[i] - x0, rz = f.pz[i] - z0;
      const t = rx * ux + rz * uz;
      if (t < 0.1 || t > L + r.p.halfL) return;
      if (Math.abs(rx * uz - rz * ux) > w) return;
      if (allow && !allow(f.px[i], f.pz[i])) return;
      n++;
    });
    const v = r.p.maxSpeed * this.skill.speed;
    const turn = Math.abs(wrap(Math.atan2(-uz, ux) - r.h)) / r.p.maxOmega;
    const home = Math.max(0, s * (ZONE_X + 0.4) - s * x1);
    let time = L / v + turn * 0.5 + 0.3 + home * (this.homeWeight ?? 0.5) / v;
    if (bias) time += bias(x1, z1) / v;
    const got = Math.min(n, r.p.capacity - r.fuel + 4);
    return { x1, z1, n, T: L / v + turn, val: got / Math.max(0.2, time) };
  }

  // A straight run must stay on our side of any HUB line and miss solid field elements.
  runClear(x0, z0, x1, z1) {
    const r = this.r;
    if ((Math.abs(x0) - HUB_X) * (Math.abs(x1) - HUB_X) < 0) return false;
    const pad = r.p.halfW + 0.08;
    for (let k = 1; k <= 4; k++) {
      const x = x0 + ((x1 - x0) * k) / 4, z = z0 + ((z1 - z0) * k) / 4;
      if (Math.abs(Math.abs(x) - HUB_X) < 0.6) return false;
      for (const b of this.w.field.boxes) {
        if (b.y0 >= r.p.height) continue;
        if (Math.abs(x - b.x) < b.hx + pad && Math.abs(z - b.z) < b.hz + pad) return false;
      }
    }
    return true;
  }

  // Higher levels sweep: drive straight through the densest patch with the intake leading,
  // the way a human driver ploughs a pile, instead of chasing balls one at a time.
  sweepCluster(cmd, dt, allow, bias) {
    const r = this.r, m = this.w.match;
    this.retarget -= dt;
    if (r.stats.intaked !== this.lastIntaked) { this.lastIntaked = r.stats.intaked; this.lastIntakeT = m.t; }
    const banned = (c) => (this.cellBan.get(c[0] * 100 + c[1]) ?? 0) > m.t;
    if (this.retarget <= 0 || !this.sweepGoal) {
      const allowed = (x, z) => (!allow || allow(x, z)) && !banned([Math.floor((x + HL) / CELL), Math.floor((z + HW) / CELL)]);
      const c = this.pickCluster(allowed, bias, this.homeWeight ?? 0.5);
      this.sweepGoal = c ? this.centroid(c, allow) : null;
      this.retarget = 0.25 + this.skill.reaction * 0.5;
    }
    cmd.intake = true;
    if (!this.sweepGoal) return null;
    const [tx, tz] = this.sweepGoal;
    const dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz) || 1;
    // Sitting on a patch without picking anything up: it's unreachable, skip it for a while.
    if (d < 1.0 && m.t - (this.lastIntakeT ?? 0) > 1.5 && this.goalCell) {
      const [gx, gz] = this.goalCell;
      for (let ax = -1; ax <= 1; ax++) for (let az = -1; az <= 1; az++) this.cellBan.set((gx + ax) * 100 + gz + az, m.t + 8);
      this.sweepGoal = null;
      this.lastIntakeT = m.t;
      return null;
    }
    // FUEL against a wall: square up and drive the intake straight into the wall.
    if (Math.abs(tx) > HL - 0.8 || Math.abs(tz) > HW - 0.6) {
      const alongX = Math.abs(tx) > HL - 0.8 && (HL - Math.abs(tx)) < (HW - Math.abs(tz)) + 0.2;
      let gx = tx, gz = tz;
      if (alongX) { cmd.heading = tx > 0 ? 0 : Math.PI; gx = Math.sign(tx) * (HL - r.p.halfL - 0.02); }
      else { cmd.heading = tz > 0 ? -Math.PI / 2 : Math.PI / 2; gz = Math.sign(tz) * (HW - r.p.halfL - 0.02); }
      // Line up a little off the wall first, then push in.
      const err = Math.abs(wrap(cmd.heading - r.h));
      if (err > 0.35) { if (alongX) gx = Math.sign(tx) * (HL - r.p.halfL - 0.6); else gz = Math.sign(tz) * (HW - r.p.halfL - 0.6); }
      return this.goTo(gx, gz, { through: err < 0.35 });
    }
    const mv = this.goTo(tx + (dx / d) * 0.8, tz + (dz / d) * 0.8, { through: true });
    cmd.heading = Math.atan2(-dz, dx);
    const err = Math.abs(wrap(cmd.heading - r.h));
    if (err > 0.9 && d < 1.5) { mv[0] *= 0.5; mv[1] *= 0.5; }
    return mv;
  }

  // Drive to FUEL and intake it. Returns movement; sets heading/intake on cmd.
  collect(cmd, dt, allow, bias) {
    if (this.lvl >= 2) {
      const mv = this.sweep(cmd, dt, allow, bias);
      if (mv) return mv;
    }
    const f = this.w.fuel, r = this.r, m = this.w.match;
    this.retarget -= dt;
    if (this.retarget <= 0 || this.ball < 0 || !f.active[this.ball] || (allow && !allow(f.px[this.ball], f.pz[this.ball]))) {
      this.pickBall(allow, bias);
      this.retarget = 0.3 + this.skill.reaction;
    }
    if (this.ball >= 0 && m.t - this.ballSince > 3.5) {
      this.blacklist.set(this.ball, m.t + 20);
      this.ball = -1;
      this.retarget = 0;
    }
    cmd.intake = true;
    if (this.ball < 0) return null;
    const bx = f.px[this.ball], bz = f.pz[this.ball];
    // Higher levels drive straight through the pile instead of braking at every ball.
    const mv = this.goTo(bx, bz, { through: this.lvl >= 2 });
    cmd.heading = Math.atan2(-(bz - r.z), bx - r.x);
    const err = Math.abs(wrap(cmd.heading - r.h));
    if (err > 0.9 && mv[2] < 1.5) { mv[0] *= this.lvl >= 3 ? 0.55 : 0.3; mv[1] *= this.lvl >= 3 ? 0.55 : 0.3; }
    return mv;
  }

  // Will FUEL fired now still count when it lands?
  scoringOnArrival() {
    const m = this.w.match, a = this.r.alliance;
    if (m.mode === 'practice') return true;
    if (this.lvl < 2) return m.hubScoring(a);
    const t = m.t + (this.r.turrets[0].shot?.T ?? FLIGHT) + 0.05;
    return m.hubActiveAt(a, t) || m.hubActiveAt(a, t - 2.6);
  }

  // Outside the zone with FUEL: is it time to go home and shoot?
  timeToReturn() {
    const r = this.r, cap = r.p.capacity;
    if (this.lvl < 2) return r.fuel >= Math.min(cap * 0.6, 25);
    if (r.fuel >= cap * F.retFull) return true;
    const c = this.brain.ctx;
    // Make sure the load gets fired before our HUB switches off.
    if (c.myOn && c.toggle !== null && c.toggle < this.travelToZone() + r.fuel / r.p.fireRate + F.retSlack) return r.fuel >= 5;
    // Nothing worth chasing nearby.
    const g = this.sweepGoal;
    if (r.fuel >= F.retLoad && (!g || Math.hypot(g[0] - r.x, g[1] - r.z) > F.retFar)) return true;
    return false;
  }

  stageSpot() {
    const s = side(this.r.alliance);
    const zs = [-2.1, 2.1, 0.0][this.slot];
    return [s * (ZONE_X + (this.slot === 2 ? 1.4 : 0.75)), s * zs];
  }

  feedTarget() {
    const s = side(this.r.alliance);
    return { x: s * (ZONE_X + 1.3), y: 0.1, z: s * (this.slot === 0 ? 1.6 : -1.6), apex: 2.6 };
  }

  // Evade an opponent leaning on us while we shoot (turrets keep firing).
  evade(mv) {
    const r = this.r;
    let ex = 0, ez = 0;
    for (const o of this.w.robots) {
      if (o.alliance === r.alliance || o.climbing) continue;
      const dx = r.x - o.x, dz = r.z - o.z, d = Math.hypot(dx, dz);
      if (d < 1.4 && d > 1e-3) { ex += (dx / d) * (1.4 - d); ez += (dz / d) * (1.4 - d); }
    }
    if (ex || ez) {
      const n = Math.hypot(ex, ez);
      // Slide sideways along the zone instead of backing into a wall.
      mv[0] += (ex / n) * 0.4; mv[1] += (ez / n) * 0.8;
    }
    return mv;
  }

  update(dt) {
    F = this.brain.P;
    const r = this.r, m = this.w.match;
    const cmd = { mx: 0, mz: 0, heading: null, intake: false, shoot: false, speedScale: this.skill.speed, spreadScale: this.skill.spread, boost: this.skill.boost ?? 1 };
    if (!m.enabled) return cmd;
    // Drop off the TOWER after an AUTO climb.
    if (m.phase === 'teleop' && r.climbing && this.role !== 'climb') r.descend();

    if (this.backT > 0) {
      this.backT -= dt;
      cmd.mx = this.backDir[0]; cmd.mz = this.backDir[1];
      cmd.intake = true;
      return cmd;
    }

    const inOwn = inZone(r.alliance, r.x);
    let mv = null;
    r.passTarget = null;

    switch (this.role) {
      case 'auto': mv = this.doAuto(cmd, dt); break;
      case 'score': mv = this.doScore(cmd, dt, inOwn); break;
      case 'stockpile': mv = this.doStockpile(cmd, dt); break;
      case 'stage': mv = this.doStage(cmd, dt, inOwn); break;
      case 'feed': mv = this.doFeed(cmd, dt, inOwn); break;
      case 'defend': mv = this.doDefend(cmd, dt); break;
      case 'counter': mv = this.doCounter(cmd, dt); break;
      case 'raid': mv = this.doRaid(cmd, dt, inOwn); break;
      case 'climb': mv = this.doClimb(cmd); break;
      default: mv = this.doSimple(cmd, dt, inOwn);
    }
    if (mv) { cmd.mx = mv[0]; cmd.mz = mv[1]; }
    // Flywheel-limited robots close in on the HUB when a shot is out of reach.
    if (cmd.shoot && inOwn && r.maxRange < 20) { const g = this.rangeMove(); if (g) { cmd.mx = g[0]; cmd.mz = g[1]; } }

    // Stuck detection.
    const want = Math.hypot(cmd.mx, cmd.mz);
    const have = Math.hypot(r.vx, r.vz);
    if (!r.climbing && want > 0.5 && have < 0.25 && this.role !== 'defend' && this.role !== 'counter') this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 0.9) {
      this.stuckT = 0;
      this.backT = 0.5 + Math.random() * 0.4;
      const a = Math.atan2(-cmd.mz, -cmd.mx) + (Math.random() - 0.5) * 2.2;
      this.backDir = [Math.cos(a), Math.sin(a)];
      this.path = []; this.pathGoal = null;
      this.ball = -1;
      this.sweepGoal = null;
    }
    return cmd;
  }

  // Move toward the HUB until it is comfortably inside shooting range (null when already there).
  rangeMove() {
    const r = this.r, s = side(r.alliance), hub = this.w.field.hubs[r.alliance];
    const dx = r.x - hub.x, dz = r.z - hub.z, d = Math.hypot(dx, dz);
    if (!this.rangeIn && d <= r.maxRange - 0.25 || this.rangeIn && d <= r.maxRange - 0.05) { this.rangeIn = true; return null; }
    this.rangeIn = false;
    const want = Math.max(0.5, r.maxRange - 0.6);
    let tx = hub.x + (dx / d) * want, tz = hub.z + (dz / d) * want;
    // Stay inside our own zone; slide sideways toward the HUB line if the zone edge is in the way.
    if (s * tx < ZONE_X + 0.35) {
      tx = s * (ZONE_X + 0.35);
      const ex = Math.abs(tx - hub.x);
      tz = hub.z + Math.sign(dz || 1) * Math.sqrt(Math.max(0, want * want - ex * ex));
    }
    return this.goTo(tx, tz);
  }

  // ---------- Roles ----------

  // AUTO: dump the preload, swipe the neutral zone (a little past the centre line),
  // come back and shoot. The weakest bot works the DEPOT and hangs L1.
  doAuto(cmd, dt) {
    const r = this.r, m = this.w.match, s = side(r.alliance);
    const tAuto = m.t - m.countdownEnd, left = m.autoEnd - m.t;
    const inOwn = inZone(r.alliance, r.x);
    cmd.shoot = inOwn && r.fuel > 0;
    if (cmd.shoot && r.fixedShooter) { cmd.heading = r.aimHeading(); cmd.headingGain = 8; }
    if (this.lvl === 0) return this.doSimple(cmd, dt, inOwn);
    const sorted = this.brain.bots().sort((a, b) => power(a.r) - power(b.r));
    const depotBot = this.lvl >= 2 && sorted.length > 1 && sorted[0] === this;
    if (depotBot && r.p.climbMax >= 1 && this.brain.tactic !== 'offense' && left < 7) return this.doClimb(cmd);
    if (r.fuel > 0 && (tAuto < 1.0 || r.fixedShooter && inOwn)) { cmd.intake = true; return [0, 0, 0]; }
    if (depotBot) {
      const own = (x) => s * x > ZONE_X + 0.3;
      const mv = this.collect(cmd, dt, own);
      if (mv) return mv;
    }
    const goHome = r.fuel >= r.p.capacity * F.autoFull || left < 5 + this.travelToZone() * 0.5;
    if (goHome && r.fuel > 0) {
      if (inOwn) { cmd.intake = true; return this.evade([0, 0, 0]); }
      const [sx, sz] = this.stageSpot();
      cmd.intake = true;
      return this.goTo(sx, sz);
    }
    // Team Update 22 says not to fully cross the centre line in AUTO, but on the field a robot
    // drifting a little past it is rarely called, and top teams do. Sweep up to autoReach
    // (alliance-local metres, negative = past the line).
    const ownHalf = (x) => s * x > F.autoReach;
    return this.collect(cmd, dt, ownHalf) || [0, 0, 0];
  }

  // 254-style loop for fixed rear shooters, with the nose always toward our own wall:
  // fire from just behind the BUMP (fireDepth into the zone, drum facing the HUB; any closer and
  // the robot sits in the lane everyone drives through, getting shoved off its aim), back over
  // the BUMP to the HUB's neutral side and let our own FUEL roll out of the exits into the
  // intake, scoop up what got knocked around nearby, drive back over the BUMP and fire again.
  bumpLoop(cmd, dt, inOwn) {
    const r = this.r, s = side(r.alliance), f = this.w.fuel, m = this.w.match, a = r.alliance;
    const cap = r.p.capacity;
    const hub = this.w.field.hubs[a];
    this.loopLane = this.brain.laneFor(this);
    const fireX = s * (ZONE_X + F.fireDepth), fireZ = this.loopLane;
    const catchX = hub.x - s * (HUB_HALF + 0.42 + r.p.halfL), catchZ = 0;
    const pending = f.hubQueue.reduce((n, q) => n + (q.alliance === a), 0);
    const nose = s > 0 ? 0 : Math.PI;
    const nearHub = (x, z) => Math.abs(x - catchX) < 1.8 && Math.abs(z) < 2.4 && s * x < s * hub.x - HUB_HALF && this.brain.laneOwns(this, z);
    cmd.intake = true;
    this.catching = this.loop === 'catch' || this.loop === 'scoop';

    if (!this.loop) this.loop = r.fuel >= 8 ? 'fire' : 'scoop';
    if (this.loop === 'fire' && r.fuel === 0) this.loop = pending > 0 && F.loopWait ? 'catch' : 'scoop';
    if (this.loop === 'catch' && (r.fuel >= cap * 0.9 || (pending === 0 && Math.hypot(catchX - r.x, catchZ - r.z) < 0.5))) this.loop = 'scoop';
    if ((this.loop === 'catch' || this.loop === 'scoop') && r.fuel >= cap * 0.9) this.loop = 'fire';

    if (this.loop === 'fire') {
      const mv = this.goTo(fireX, fireZ, { through: true });
      const d = Math.hypot(fireX - r.x, fireZ - r.z);
      // Only park once the frame is actually over the zone line.
      if (d < 0.3 && inOwn) { mv[0] = 0; mv[1] = 0; }
      // Start turning onto the HUB on the way up the BUMP.
      cmd.heading = d < 1.6 ? r.aimHeading() : nose;
      cmd.headingGain = 8;
      cmd.shoot = inOwn && r.fuel > 0 && this.scoringOnArrival();
      return mv;
    }
    if (this.loop === 'catch') {
      const near = Math.hypot(catchX - r.x, catchZ - r.z);
      const mv = this.goTo(catchX, catchZ, { through: near > 1.0 });
      if (near < 0.25) { mv[0] = 0; mv[1] = 0; }
      cmd.heading = nose;
      cmd.headingGain = 6;
      return mv;
    }
    // scoop: FUEL knocked around near our HUB first, then anywhere on our half.
    if (F.loopWait && pending >= 4 && r.fuel < cap * 0.6) { this.loop = 'catch'; return this.bumpLoop(cmd, dt, inOwn); }
    const mv = (F.loopNearHub && this.collect(cmd, dt, nearHub)) || this.collect(cmd, dt, (x) => s * x > -0.6);
    // Head back up once the load is worth the trip, our shift is running out, or the carpet is bare.
    const c = this.brain.ctx;
    const hurry = c.myOn && c.toggle !== null && c.toggle < this.travelToZone() + r.fuel / r.p.fireRate + F.loopSlack;
    const far = this.sweepGoal && Math.hypot(this.sweepGoal[0] - r.x, this.sweepGoal[1] - r.z) > F.loopFar;
    if (!mv || r.fuel >= cap * F.loopFull || (hurry && r.fuel >= 5) || (far && r.fuel >= cap * F.loopFarLoad)) {
      if (r.fuel >= 5) this.loop = 'fire';
      return mv || [0, 0, 0];
    }
    return mv;
  }

  // Firing spot for the corner loop: deep in our zone off to one side, where nobody drives
  // through. Each looper gets its own side (from the same deal as the BUMP loop's lanes).
  cornerSpot() {
    const s = side(this.r.alliance), lane = this.brain.laneFor(this);
    const z = Math.abs(lane) > 2.5 ? s * 1.3 : Math.sign(lane) * F.cornerZ;
    return [s * (ZONE_X + F.cornerDepth), z];
  }

  // How a human drives a 254-style robot (from the logged matches): fire standing still from
  // deep in our zone, go out through the TRENCH, plough the neutral zone until well loaded,
  // come back and fire again.
  cornerLoop(cmd, dt, inOwn) {
    const r = this.r, s = side(r.alliance), cap = r.p.capacity;
    cmd.intake = true;
    if (r.fuel === 0) this.loop = 'collect';
    else if (!this.loop) this.loop = r.fuel >= 8 ? 'fire' : 'collect';
    if (this.loop === 'fire') {
      const [fx, fz] = this.cornerSpot();
      const mv = this.goTo(fx, fz, { through: true });
      const d = Math.hypot(fx - r.x, fz - r.z);
      if (d < 0.35 && inOwn) { mv[0] = 0; mv[1] = 0; }
      if (inOwn && d < 2.5) { cmd.heading = r.aimHeading(); cmd.headingGain = 8; }
      cmd.shoot = inOwn && r.fuel > 0 && this.scoringOnArrival();
      return mv;
    }
    const mv = this.collect(cmd, dt, (x) => s * x > -0.6);
    const c = this.brain.ctx;
    const hurry = c.myOn && c.toggle !== null && c.toggle < this.travelToZone() + 1.5 + r.fuel / r.p.fireRate + F.loopSlack;
    const far = this.sweepGoal && Math.hypot(this.sweepGoal[0] - r.x, this.sweepGoal[1] - r.z) > F.loopFar;
    if (r.fuel >= cap * F.cornerFull || (!mv && r.fuel >= 5) || (hurry && r.fuel >= 5) || (far && r.fuel >= cap * F.loopFarLoad)) this.loop = 'fire';
    if (inZone(r.alliance, r.x) && r.fuel > 0) cmd.shoot = this.scoringOnArrival();
    return mv || [0, 0, 0];
  }

  doScore(cmd, dt, inOwn) {
    const r = this.r, s = side(r.alliance);
    const cap = r.p.capacity;
    cmd.intake = true;
    if (r.fixedShooter && this.lvl >= 2 && F.cornerLoop) return this.cornerLoop(cmd, dt, inOwn);
    if (r.fixedShooter && this.lvl >= 2 && F.bumpLoop) return this.bumpLoop(cmd, dt, inOwn);
    if (inOwn && r.fuel > 0) {
      cmd.shoot = this.scoringOnArrival();
      if (r.fixedShooter) {
        // The shooter faces back, so aiming at the HUB points the intake at our wall: translate
        // (swerve) onto zone FUEL in front of us while holding the aim.
        const ahead = (x) => s * x > ZONE_X + 0.15 && s * x > s * r.x + 0.2;
        const mv = F.fixedMove && r.fuel < cap && this.lvl >= 2 ? this.collect(cmd, dt, ahead) : null;
        cmd.heading = r.aimHeading();
        cmd.headingGain = 8;
        if (mv) { mv[0] *= 0.6; mv[1] *= 0.6; return mv; }
        return [0, 0, 0];
      }
      // Turrets keep moving while they shoot: hoover up FUEL fed into our zone, but stay near
      // the zone line so the next trip out is short.
      const depth = this.lvl >= 2 ? F.campDepth : 9;
      const zone = (x) => s * x > ZONE_X + 0.15 && s * x < ZONE_X + depth;
      if (this.lvl >= 3 && F.exitCatch && r.fuel <= r.p.fireRate * F.catchLoad && !this.brain.bots().some((b) => b !== this && b.catching)) {
        const lane = (r.z >= 0 ? 1 : -1) * 1.65;
        return this.evade(this.goTo(s * (ZONE_X + 0.45), lane, { through: true }));
      }
      const mv = r.fuel < cap && F.zoneCamp ? this.collect(cmd, dt, zone, (x, z) => Math.hypot(x - r.x, z - r.z) > 3.5 ? 5 : 0) : null;
      if (!mv && this.lvl >= 2) {
        // Nothing to pick up: fire from just inside the nearest lane.
        let lane = this.lanes()[0];
        for (const l of this.lanes()) if (Math.abs(l - r.z) < Math.abs(lane - r.z)) lane = l;
        const g = this.goTo(s * (ZONE_X + 0.6), lane);
        if (g[2] < 0.4) { g[0] = 0; g[1] = 0; }
        return this.evade(g);
      }
      return this.evade(mv || [0, 0, 0]);
    }
    // Elite loop: dump, hop the BUMP and sit nose-in at our HUB exits to catch our own FUEL as
    // it comes back out, then hop back and dump again. One catcher per alliance.
    const wasCatching = this.catching;
    this.catching = false;
    if (F.exitCatch && this.lvl >= 3 && r.fuel < cap * 0.9 && (wasCatching || r.fuel <= 3)) {
      const a = r.alliance, f = this.w.fuel;
      const hub = this.w.field.hubs[a];
      const cx = hub.x - s * (HUB_HALF + 0.42 + r.p.halfL), cz = 0;
      const pending = f.hubQueue.reduce((n, q) => n + (q.alliance === a), 0);
      let loose = 0;
      f.query(cx - 1.2, cz - 1.2, cx + 1.2, cz + 1.2, (i) => { if (f.py[i] < 0.25 && f.shooter[i] < 0) loose++; });
      const mate = this.brain.bots().some((b) => b !== this && b.catching);
      const near = Math.hypot(cx - r.x, cz - r.z);
      const go = wasCatching ? pending > 0 : pending >= F.catchMin;
      if (!mate && go) {
        this.catching = true;
        cmd.intake = true;
        cmd.heading = s > 0 ? 0 : Math.PI;
        cmd.headingGain = 6;
        const mv = this.goTo(cx, cz, { through: near > 1.2 });
        if (near < 0.25) { mv[0] = 0; mv[1] = 0; }
        else if (near < 1.2 && loose >= 3 && pending === 0) {
          // Exit stream finished: sweep up what rolled past us.
          return this.collect(cmd, dt, (x) => Math.abs(x - cx) < 1.6, null) || mv;
        }
        return mv;
      }
    }
    if (r.fuel === 0 || (!inOwn && !this.timeToReturn())) {
      // Prefer FUEL already in our zone, then the neutral zone nearest home.
      const bias = (x) => (this.lvl >= 2 ? 0 : s * x > ZONE_X ? -2.5 : 0) + (inZone(other(r.alliance), x) ? 8 : 0);
      // While our HUB is live, stay on our half: every metre out is a metre back.
      const near = this.lvl >= 2 ? (x) => s * x > -0.6 : null;
      const mv = this.collect(cmd, dt, near, bias);
      if (inOwn && r.fuel > 0) cmd.shoot = this.scoringOnArrival();
      if (mv) return mv;
    }
    cmd.shoot = inOwn && r.fuel > 0 && this.scoringOnArrival();
    if (this.lvl >= 2) {
      // Head for the nearest spot just inside the zone and start firing the moment we cross.
      cmd.intake = true;
      return this.goTo(s * (ZONE_X + 0.55), Math.max(-3.3, Math.min(3.3, r.z)), { through: true });
    }
    const [sx, sz] = this.stageSpot();
    return this.goTo(sx, sz);
  }

  doStockpile(cmd, dt) {
    const r = this.r, s = side(r.alliance);
    cmd.intake = true;
    const inOwn = inZone(r.alliance, r.x);
    // Fixed shooters can't aim a pass while sweeping, so once full they go and wait on the BUMP.
    if (r.fuel >= r.p.capacity && (this.lvl < 3 || inOwn || r.fixedShooter)) return this.doStage(cmd, dt, inOwn);
    // Einstein: keep half a hopper and lob the rest into our zone, building a pile to fire from
    // non-stop once the HUB is live. Stop passing in time to arrive full.
    const c = this.brain.ctx;
    const fillTime = (r.p.capacity - r.fuel) / 8 + this.travelToZone() + 3;
    const passAt = c.toggle !== null && c.toggle > fillTime ? F.passKeep : 1.01;
    if (r.fuel >= r.p.capacity * passAt && !inOwn && this.lvl >= 3 && !r.fixedShooter) {
      r.passTarget = this.feedTarget();
      cmd.shoot = true;
      if (r.fixedShooter) cmd.heading = r.aimHeading();
    }
    const out = this.w.field.outposts[r.alliance];
    if (this.brain.outpostUser === this && out.stock > 0) {
      // Park nose-in at the OUTPOST opening and let the human player feed us.
      const tx = out.mouth.x - s * (r.p.halfL + 0.12), tz = out.mouth.z;
      const mv = this.goTo(tx, tz);
      cmd.heading = s > 0 ? 0 : Math.PI;
      return mv;
    }
    // Starve the opponents: take neutral FUEL first, nearer their side at higher levels.
    const bias = (x) => (inZone(other(r.alliance), x) ? 6 : 0) + (this.lvl >= 3 ? s * x * 0.15 : 0);
    return this.collect(cmd, dt, null, bias) || this.goTo(...this.stageSpot());
  }

  doStage(cmd, dt, inOwn) {
    const r = this.r;
    cmd.intake = true;
    // Fixed shooters wait on their firing spot so the first shot of the shift is already lined up.
    const [sx, sz] = r.fixedShooter && this.lvl >= 2 && F.cornerLoop ? this.cornerSpot()
      : r.fixedShooter && this.lvl >= 2 && F.bumpLoop ? [side(r.alliance) * (ZONE_X + F.fireDepth), this.brain.laneFor(this)] : this.stageSpot();
    const mv = this.goTo(sx, sz);
    if (mv[2] < 0.5 && inOwn) { mv[0] = 0; mv[1] = 0; }
    cmd.shoot = inOwn && r.fuel > 0 && this.scoringOnArrival();
    if (r.fixedShooter && inOwn) { cmd.heading = r.aimHeading(); cmd.headingGain = 8; }
    return mv;
  }

  // Collect in the neutral zone and lob FUEL into our zone for the scorers.
  doFeed(cmd, dt, inOwn) {
    const r = this.r, s = side(r.alliance);
    cmd.intake = true;
    const neutral = (x) => Math.abs(x) < HUB_X - 0.6;
    if (inOwn && r.fuel > 0) {
      cmd.shoot = this.scoringOnArrival();
      if (cmd.shoot) return [0, 0, 0];
    }
    r.passTarget = this.feedTarget();
    if (!inOwn && r.fuel >= 3) {
      cmd.shoot = true;
      if (r.fixedShooter) cmd.heading = r.aimHeading();
    }
    const bias = (x) => s * x * -0.1;
    const mv = this.collect(cmd, dt, neutral, bias);
    if (r.fixedShooter && cmd.shoot) return [0, 0, 0];
    return mv || [0, 0, 0];
  }

  // Hold the BUMP/TRENCH lane a loaded opponent needs to get home through; body-block them
  // in the neutral zone. Never enter the opponent's alliance zone. With nobody to stop,
  // starve the neutral zone instead.
  doDefend(cmd, dt) {
    const r = this.r;
    const opp = other(r.alliance), so = side(opp);
    let target = null, best = 0;
    for (const o of this.w.robots) {
      if (o.alliance !== opp || o.climbing || inZone(opp, o.x)) continue;
      const v = o.fuel + power(o) * 0.15 + (o.isPlayer ? 4 : 0);
      if (o.fuel >= 5 && v > best) { best = v; target = o; }
    }
    cmd.intake = true;
    if (!target) {
      r.passTarget = this.feedTarget();
      if (r.fuel >= 3) cmd.shoot = true;
      const neutral = (x) => Math.abs(x) < HUB_X - 0.6 && so * x > -0.5;
      return this.collect(cmd, dt, neutral) || [0, 0, 0];
    }
    const lanes = target.p.fitsTrench ? LANES : LANES.filter((z) => !TRENCH_LANES.includes(z));
    let lane = lanes[0];
    for (const l of lanes) if (Math.abs(l - target.z) < Math.abs(lane - target.z)) lane = l;
    const holdX = so * (HUB_X - 1.05);
    const d = Math.hypot(target.x - r.x, target.z - r.z);
    let gx, gz;
    if (d < 2.5) {
      // Get between the target and its zone.
      gx = target.x + so * 0.9; gz = target.z;
    } else {
      gx = holdX; gz = lane + (target.z - lane) * 0.3;
    }
    if (so * gx > HUB_X - 0.75) gx = so * (HUB_X - 0.75);
    cmd.heading = Math.atan2(-(target.z - r.z), target.x - r.x);
    return this.goTo(gx, gz, { ram: d < 2.5 ? target : null });
  }

  // Push an opponent defender off our scorers.
  doCounter(cmd, dt) {
    const t = this.brain.counterTarget;
    const r = this.r;
    cmd.intake = true;
    if (!t || inZone(t.alliance, t.x)) return this.doScore(cmd, dt, inZone(r.alliance, r.x));
    cmd.heading = Math.atan2(-(t.z - r.z), t.x - r.x);
    if (inZone(r.alliance, r.x) && r.fuel > 0) cmd.shoot = this.scoringOnArrival();
    return this.goTo(t.x, t.z, { ram: t });
  }

  // Go into the opponent zone, take their FUEL and pass it home.
  doRaid(cmd, dt, inOwn) {
    const r = this.r, opp = other(r.alliance);
    cmd.intake = true;
    r.passTarget = this.feedTarget();
    if (!inOwn && r.fuel >= 6) cmd.shoot = true;
    const theirs = (x) => inZone(opp, x);
    const mv = this.collect(cmd, dt, theirs);
    if (mv) return mv;
    return this.doFeed(cmd, dt, inOwn);
  }

  doClimb(cmd) {
    const r = this.r, w = this.w, m = w.match, s = side(r.alliance);
    const tower = w.towers[r.alliance];
    const tx = tower.climbX, tz = tower.z + (this.slot - 1) * 0.35;
    const goal = m.phase === 'auto' ? 1 : this.climbGoal;
    let mv = [0, 0, 0];
    if (!r.climbing) {
      mv = this.goTo(tx, tz);
      cmd.heading = s > 0 ? 0 : Math.PI;
      if (r.inClimbZone(w) && Math.hypot(r.vx, r.vz) < 1.0) r.requestClimb(w, goal);
    } else if (r.climbTarget < goal) {
      r.requestClimb(w, goal);
    }
    cmd.shoot = inZone(r.alliance, r.x) && r.fuel > 0 && this.scoringOnArrival();
    return mv;
  }

  // Easy bots: the original collect-then-score loop.
  doSimple(cmd, dt, inOwn) {
    const r = this.r, m = this.w.match;
    const active = m.hubActive(r.alliance);
    const soon = m.hubActiveAt(r.alliance, m.t + 4);
    if (r.fuel === 0) this.mode = 'collect';
    else if (r.fuel >= r.p.capacity * 0.9) this.mode = 'go';
    else if (this.mode === 'collect' && (active || soon) && r.fuel >= Math.min(12, r.p.capacity * 0.5)) this.mode = 'go';
    else if (this.mode === 'go' && !active && !soon) this.mode = 'collect';
    if (this.mode === 'collect') {
      const mv = this.collect(cmd, dt, null, (x) => (inZone(other(r.alliance), x) ? 7 : 0));
      cmd.shoot = inOwn && m.hubScoring(r.alliance) && r.fuel > 0;
      return mv || [0, 0, 0];
    }
    const [sx, sz] = this.stageSpot();
    const mv = this.goTo(sx, sz);
    if (mv[2] < 0.6) { mv[0] = 0; mv[1] = 0; }
    cmd.intake = true;
    cmd.shoot = inOwn && (m.hubScoring(r.alliance) || m.mode === 'practice');
    if (r.fixedShooter && r.fuel > 0) cmd.heading = r.aimHeading();
    return mv;
  }
}
