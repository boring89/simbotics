import { HL, HW, ZONE_X, side } from './config.js';
import { inZone } from './field.js';

// Pre-programmed AUTO routines: a start pose and a list of steps the robot runs on its own during
// the 20 s AUTO period, like a PathPlanner auto. Coordinates are stored for the blue alliance
// (blue wall at -x); red gets the same routine turned 180° about the field centre.
// No DOM here: Web Workers run routines too.

export const START_X = -(ZONE_X + 0.5);   // blue starting line, robot centre
export const STEP_TYPES = {
  path: '路徑', shoot: '射擊', intake: '原地吸球', wait: '等待', climb: '攀爬 L1',
};
export const HEADINGS = { free: '不轉向', hub: '對準 HUB', travel: '朝行進方向' };

export function newStep(type, from) {
  if (type === 'path') {
    const [x, z] = from || [START_X, 0];
    return { type, pts: [[Math.min(-0.5, x + 2), z]], speed: 0.8, intake: true, shoot: false, heading: 'free' };
  }
  if (type === 'shoot') return { type, time: 3 };
  if (type === 'intake' || type === 'wait') return { type, time: 1 };
  return { type };
}

export function newRoutine(name = '新的自動程式') {
  return { id: Date.now().toString(36), name, start: { z: -1.65, h: 0 }, steps: [] };
}

// Ready-made examples, so the editor never starts empty.
export function templates() {
  const sweep = { ...newRoutine('預載 → 中場掃球 → 回來射'), id: 'tpl-sweep' };
  sweep.start = { z: -1.65, h: 0 };
  sweep.steps = [
    { type: 'shoot', time: 1.5 },
    { type: 'path', pts: [[-2.6, -1.65], [-0.6, -1.2], [-0.6, 1.0]], speed: 0.85, intake: true, shoot: false, heading: 'travel' },
    { type: 'path', pts: [[-2.6, 1.65], [-5.2, 1.2]], speed: 0.9, intake: true, shoot: true, heading: 'hub' },
    { type: 'shoot', time: 6 },
  ];
  const depot = { ...newRoutine('預載 → DEPOT → L1'), id: 'tpl-depot' };
  depot.start = { z: -3.0, h: Math.PI };
  depot.steps = [
    { type: 'shoot', time: 1.5 },
    // Nose first into the DEPOT: the intake only takes balls right at the front bumper.
    { type: 'path', pts: [[-6.7, -1.85], [-7.85, -1.85]], speed: 0.4, intake: true, shoot: false, heading: 'travel' },
    { type: 'path', pts: [[-6.2, -1.0]], speed: 0.7, intake: true, shoot: true, heading: 'hub' },
    { type: 'shoot', time: 3 },
    { type: 'climb' },
  ];
  return [sweep, depot];
}

// Blue-frame point -> world point for an alliance.
const flip = (alliance) => (alliance === 'red' ? -1 : 1);
export const toWorld = (alliance, x, z) => [x * flip(alliance), z * flip(alliance)];
export const startPose = (alliance, start) => {
  const [x, z] = toWorld(alliance, START_X, start.z);
  return [x, z, start.h + (alliance === 'red' ? Math.PI : 0)];
};

// Smooth path through the waypoints (Catmull-Rom), sampled about every 5 cm.
export function spline(pts) {
  if (pts.length < 2) return pts.map((p) => [...p]);
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.05));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([...pts[pts.length - 1]]);
  return out;
}

const clampField = ([x, z]) => [Math.max(-HL + 0.4, Math.min(HL - 0.4, x)), Math.max(-HW + 0.4, Math.min(HW - 0.4, z))];
const headingOf = (dx, dz) => Math.atan2(-dz, dx);

// Runs one routine for one robot. cmd() returns a drive command in the same shape as the player's.
export class AutoRunner {
  constructor(routine, robot) {
    this.steps = routine.steps || [];
    this.r = robot;
    this.i = 0;
    this.t = 0;          // time in the current step
    this.pp = null;      // the path step in progress
  }

  get done() { return this.i >= this.steps.length; }
  get label() { return this.done ? '完成' : `${this.i + 1}/${this.steps.length} ${STEP_TYPES[this.steps[this.i].type]}`; }

  next() { this.i++; this.t = 0; this.pp = null; }

  cmd(world, dt) {
    const r = this.r;
    const c = { mx: 0, mz: 0, heading: null, intake: false, shoot: false };
    for (let guard = 0; guard < 4 && !this.done; guard++) {
      const st = this.steps[this.i];
      this.t += guard ? 0 : dt;
      const finished = this[st.type]?.(st, c, world) ?? true;
      if (!finished) return c;
      this.next();
    }
    return c;
  }

  aim(c) {
    if (this.r.fuel > 0 && this.r.fixedShooter) { c.heading = this.r.aimHeading(); c.headingGain = 8; }
  }

  path(st, c, world) {
    const r = this.r;
    if (!this.pp) {
      const pts = [[r.x, r.z], ...st.pts.map((p) => clampField(toWorld(r.alliance, p[0], p[1])))];
      const line = spline(pts);
      const cum = [0];
      for (let k = 1; k < line.length; k++) cum.push(cum[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
      this.pp = { line, cum, k: 0 };
      // Give up on a path that takes far longer than it should (blocked by a robot, say).
      this.limit = cum[cum.length - 1] / (r.p.maxSpeed * Math.max(0.2, st.speed)) * 2 + 2;
    }
    const P = this.pp, { line, cum } = P, end = line.length - 1;
    // Closest point ahead of where we were (never runs backwards).
    let best = Infinity;
    for (let k = P.k; k < Math.min(end + 1, P.k + 60); k++) {
      const d = Math.hypot(line[k][0] - r.x, line[k][1] - r.z);
      if (d < best) { best = d; P.k = k; }
    }
    const left = cum[end] - cum[P.k] + Math.hypot(line[P.k][0] - r.x, line[P.k][1] - r.z) * (P.k === end ? 1 : 0);
    const toEnd = Math.hypot(line[end][0] - r.x, line[end][1] - r.z);
    if (toEnd < 0.1 || this.t > this.limit) return true;
    // Pure pursuit: head for a point 0.45 m further along, slowing down to stop on the last point.
    let la = P.k;
    while (la < end && cum[la] - cum[P.k] < 0.45) la++;
    const tx = line[la][0] - r.x, tz = line[la][1] - r.z, d = Math.hypot(tx, tz) || 1;
    const vmax = r.p.maxSpeed;
    const brake = Math.sqrt(2 * r.p.accel * 0.8 * Math.max(0, Math.min(left, toEnd))) / vmax;
    const sp = Math.max(0.12, Math.min(st.speed, brake));
    c.mx = (tx / d) * sp; c.mz = (tz / d) * sp;
    c.intake = !!st.intake;
    const own = inZone(r.alliance, r.x);
    c.shoot = !!st.shoot && own && r.fuel > 0;
    if (st.heading === 'hub' || c.shoot) this.aim(c);
    if (st.heading === 'hub' && c.heading === null && r.fixedShooter) {
      // Empty fixed shooter: face the HUB anyway, ready for the next load.
      const hub = world.field.hubs[r.alliance];
      c.heading = headingOf(hub.x - r.x, hub.z - r.z) - r.turrets.find((u) => u.fixed !== undefined).fixed;
    } else if (st.heading === 'travel' && d > 0.05 && c.heading === null) {
      c.heading = headingOf(tx, tz);
    }
    return false;
  }

  shoot(st, c) {
    const r = this.r;
    c.intake = true;
    c.shoot = r.fuel > 0 && inZone(r.alliance, r.x);
    this.aim(c);
    if (r.fuel === 0) this.empty = (this.empty ?? 0) + 1; else this.empty = 0;
    // Done when the time is up, or a moment after the last ball leaves.
    return this.t >= st.time || this.empty > 30;
  }

  intake(st, c) { c.intake = true; return this.t >= st.time; }
  wait(st) { return this.t >= st.time; }

  climb(st, c, world) {
    const r = this.r, t = world.towers[r.alliance], s = side(r.alliance);
    if (r.climbing) return false;
    const dx = t.climbX - r.x, dz = t.z - r.z, d = Math.hypot(dx, dz);
    const sp = Math.min(0.7, Math.max(0.15, d / 1.2));
    if (d > 0.05) { c.mx = (dx / d) * sp; c.mz = (dz / d) * sp; }
    c.heading = s > 0 ? 0 : Math.PI;
    c.shoot = r.fuel > 0 && inZone(r.alliance, r.x);
    if (r.inClimbZone(world) && Math.hypot(r.vx, r.vz) < 1.0) r.requestClimb(world, 1);
    return false;
  }
}

// ---------- Storage ----------
const KEY = 'simbotics.autos';
export function loadAutos() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(v) ? v : templates(); } catch { return templates(); }
}
export function saveAutos(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}
// Just what a match needs (goes to Web Workers with the settings).
export const packRoutine = (r) => (r ? { start: { ...r.start }, steps: structuredClone(r.steps) } : null);
