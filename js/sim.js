import { ZONE_X, DEPOT, STAGE, ROBOT_PRESETS, BOT_SKILL, side, other } from './config.js';
import { Fuel } from './fuel.js';
import { Robot } from './robot.js';
import { Match } from './match.js';
import { Bot, TeamBrain, TACTICS } from './ai.js';
import { registerBuilds } from './parts.js';

// Match setup and the fixed-rate physics step, shared by the game page and the headless
// benchmark (which runs whole matches in Web Workers without drawing anything).

function randomTeam(used) {
  let n;
  do { n = 100 + Math.floor(Math.random() * 9800); } while (used.has(n));
  used.add(n);
  return n;
}

// playerBot: a BOT_SKILL key to have a bot drive the player's robot (benchmarks), else null.
export function createWorld(scene, field, settings, playerBot = null) {
  // Builder robots travel with the settings so Web Workers know them too.
  if (settings.customs) registerBuilds(settings.customs);
  const mode = settings.mode;
  const match = new Match(mode === 'practice' ? 'practice' : 'match');
  const robots = [];
  const used = new Set([+settings.team]);
  const me = settings.alliance;
  const myPreset = ROBOT_PRESETS[settings.preset];
  const player = new Robot(0, me, myPreset.team ?? settings.team, myPreset, true);
  used.add(player.number);
  robots.push(player);
  if (mode === 'match') {
    // Picked robots first; "random" slots get the real 2026 robots nobody took (shuffled),
    // topped up with generic ones.
    const picks = [...(settings.allyBots || []), ...(settings.oppBots || [])];
    const real = Object.keys(ROBOT_PRESETS).filter((k) => ROBOT_PRESETS[k].real && k !== settings.preset && !picks.includes(k));
    for (let i = real.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [real[i], real[j]] = [real[j], real[i]]; }
    const pool = [...real, 'balanced', 'shuttle', 'hopper'];
    // Event matches name every robot: settings.lineup = { ally: [2], opp: [3] } of { preset, number, skill }.
    const line = settings.lineup;
    for (let i = 0; i < 5; i++) {
      const t = line && (i < 2 ? line.ally[i] : line.opp[i - 2]);
      const pr = t ? ROBOT_PRESETS[t.preset] : ROBOT_PRESETS[ROBOT_PRESETS[picks[i]] ? picks[i] : pool.shift()];
      const num = t ? t.number : pr.team && !used.has(pr.team) ? pr.team : randomTeam(used);
      used.add(num);
      const r = new Robot(robots.length, i < 2 ? me : other(me), num, pr, false);
      if (t?.skill) r.botSkill = BOT_SKILL[t.skill];
      robots.push(r);
    }
  }

  const neutral = STAGE.neutralCols * STAGE.neutralRows;
  const total = neutral + STAGE.depot * 2 + STAGE.outpost * 2 + STAGE.preload * robots.length + 40;
  const fuel = new Fuel(scene, total);
  const sp = 0.152;
  for (let i = 0; i < STAGE.neutralCols; i++) {
    for (let j = 0; j < STAGE.neutralRows; j++) {
      fuel.spawn((i - (STAGE.neutralCols - 1) / 2) * sp, 0.075, (j - (STAGE.neutralRows - 1) / 2) * sp);
    }
  }
  for (const a of ['red', 'blue']) {
    const s = side(a);
    for (let k = 0; k < STAGE.depot; k++) {
      const cx = DEPOT.x0 + 0.08 + (k % 4) * 0.155, cz = DEPOT.z0 + 0.1 + Math.floor(k / 4) * 0.155;
      fuel.spawn(s * cx, 0.075, s * cz);
    }
    field.outposts[a].stock = STAGE.outpost;
    field.outposts[a].feedT = 0;
  }
  // The extra pool slots stay inactive: they back preloads and OUTPOST stock.

  // Starting line positions, facing the neutral zone.
  const starts = [-1.65, 1.65, -3.37];
  for (const a of ['red', 'blue']) {
    const s = side(a);
    robots.filter((r) => r.alliance === a).forEach((r, k) => {
      r.place(s * (ZONE_X + 0.5), s * starts[k], s > 0 ? Math.PI : 0);
      r.fuel = STAGE.preload;
      scene.add(r.mesh);
    });
  }

  const world = { match, robots, fuel, field, towers: field.towers, bots: [], player, playerBot: null, lastSeg: null, brains: {}, log: null };
  // One strategy brain per alliance; teammates and opponents can use different levels and tactics.
  const keys = Object.keys(TACTICS);
  for (const a of ['red', 'blue']) {
    const mine = a === me;
    const skill = BOT_SKILL[mine ? settings.allySkill : settings.oppSkill] || BOT_SKILL.hard;
    let tactic = mine ? settings.allyTactic : settings.oppTactic;
    if (!TACTICS[tactic]) tactic = keys[Math.floor(Math.random() * keys.length)];
    world.brains[a] = new TeamBrain(world, a, tactic, skill, settings.aiParams?.[a]);
  }
  const slots = { red: 0, blue: 0 };
  for (const r of robots) {
    const brain = world.brains[r.alliance];
    if (r.isPlayer && !playerBot) { slots[r.alliance]++; continue; }
    const bot = new Bot(r, world, r.isPlayer ? BOT_SKILL[playerBot] : r.botSkill || brain.skill, slots[r.alliance]++ % 3, brain);
    if (r.isPlayer) world.playerBot = bot;
    world.bots.push(bot);
  }
  return world;
}

// Final score and per-robot numbers, as plain data (benchmarks and events store these).
export function summarize(world) {
  const m = world.match;
  const part = (a) => ({ ...m.score[a], total: m.total(a), fuel: m.score[a].autoFuel + m.score[a].teleFuel, rp: m.rankingPoints(a) });
  return {
    total: { red: m.total('red'), blue: m.total('blue') },
    fuel: { red: m.score.red.autoFuel + m.score.red.teleFuel, blue: m.score.blue.autoFuel + m.score.blue.teleFuel },
    red: part('red'), blue: part('blue'),
    robots: world.robots.map((r) => ({
      alliance: r.alliance, number: r.number, preset: r.p.model, player: r.isPlayer,
      ...r.stats, climb: r.climbLevel,
    })),
  };
}

function feedOutposts(world, dt) {
  for (const a of ['red', 'blue']) {
    const o = world.field.outposts[a];
    if (world.match.mode === 'practice' && o.stock < 5) o.stock = 24;
    o.stockG.children.forEach((b, i) => { b.visible = i < o.stock; });
    o.feedT -= dt;
    if (o.stock <= 0 || o.feedT > 0 || !world.match.enabled) continue;
    for (const r of world.robots) {
      if (r.alliance !== a || !r.intakeOn || r.fuel >= r.p.capacity) continue;
      const [lx, lz] = r.toLocal(o.mouth.x, o.mouth.z);
      if (lx > 0.2 && lx < 1.3 && Math.abs(lz) < 0.45) {
        const sp = 1.6 + Math.random() * 0.3;
        if (world.fuel.spawn(o.mouth.x, o.mouth.y, o.mouth.z + (Math.random() - 0.5) * 0.1, o.dir.x * sp, 0, (Math.random() - 0.5) * 0.3) >= 0) {
          o.stock--;
          o.feedT = 0.3;
        }
        break;
      }
    }
  }
}

// One physics step. pcmd drives the player's robot (ignored when a bot drives it).
export function stepWorld(world, dt, pcmd) {
  const { match, robots, fuel, field } = world;
  match.update(dt, robots);

  const enabled = match.enabled;
  if (!world.playerBot) world.player.update(dt, pcmd, world, enabled);
  for (const a in world.brains) world.brains[a].update(dt);
  for (const b of world.bots) b.r.update(dt, b.update(dt), world, enabled);

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < robots.length; i++) for (let j = i + 1; j < robots.length; j++) Robot.collidePair(robots[i], robots[j]);
    for (const r of robots) r.collide(world);
  }

  fuel.step(dt, field.boxes, field.hubs, (alliance, i) => {
    const counted = match.scoreFuel(alliance);
    const sid = fuel.shooter[i];
    if (counted && sid >= 0 && robots[sid] && robots[sid].alliance === alliance) robots[sid].stats.scored++;
  }, match.t);
  for (const r of robots) r.interactFuel(fuel, dt);
  feedOutposts(world, dt);
  if (world.log) world.log.step(dt);
}
