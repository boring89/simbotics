import { ROBOT_PRESETS } from './config.js';

// Robot builder: a catalog of mechanisms and the rules that turn a pick of one per slot into a robot
// preset. Builds are { id, name, color, parts: { frame, drive, intake, hopper, shooter, climber } }.
// No DOM here: Web Workers compile builds too.

export const WEIGHT_LIMIT = 115;   // lb, without bumpers and battery

export const SLOTS = {
  frame: {
    label: '底盤',
    options: {
      square: { name: '標準方形 27×27 in', w: 33, halfL: 0.435, halfW: 0.435 },
      compact: { name: '小型 24×24 in', w: 30, halfL: 0.4, halfW: 0.4, omega: 1.12, desc: '轉向較靈活' },
      wide: { name: '寬型 24×30 in', w: 35, halfL: 0.4, halfW: 0.475, desc: 'intake 較寬' },
      long: { name: '長型 30×24 in', w: 35, halfL: 0.475, halfW: 0.4, desc: 'hopper 較深' },
      round: { name: '圓形 直徑 28 in', w: 34, halfL: 0.46, halfW: 0.46, shape: 'round', desc: '碰撞時較容易滑開' },
    },
  },
  drive: {
    label: '驅動',
    options: {
      swerve: { name: 'Swerve · 均衡齒比', w: 26, speed: 4.6, accel: 11, omega: 7 },
      swerveFast: { name: 'Swerve · 高速齒比', w: 26, speed: 5.0, accel: 9.5, omega: 7 },
      swerveTorque: { name: 'Swerve · 高扭力齒比', w: 26, speed: 4.0, accel: 13, omega: 7.5 },
      mecanum: { name: 'Mecanum', w: 18, speed: 3.9, accel: 8.5, omega: 5.5, desc: '較輕但較慢' },
    },
  },
  intake: {
    label: 'Intake',
    options: {
      full: { name: '全寬滑軌伸出', w: 16, width: 0.92, deploy: 0.28, rate: 22 },
      over: { name: '翻出式', w: 11, width: 0.75, deploy: 0.22, rate: 20 },
      fixed: { name: '固定內嵌式', w: 6, width: 0.6, deploy: 0, rate: 16 },
    },
  },
  hopper: {
    label: 'Hopper',
    options: {
      medium: { name: '中型（低矮）', w: 9, cap: 42, height: 0.52, trench: true },
      small: { name: '小型（低矮）', w: 5, cap: 26, height: 0.45, trench: true },
      expand: { name: '可展開式（可鑽 TRENCH）', w: 17, cap: 58, height: 0.56, trench: true },
      tall: { name: '大型（高，鑽不過 TRENCH）', w: 13, cap: 66, height: 0.76, trench: false },
    },
  },
  shooter: {
    label: '射手',
    options: {
      turret: { name: '單砲塔', w: 16, rate: 10, spread: 0.028, kind: 'turret' },
      turretFast: { name: '單砲塔 · 雙飛輪', w: 21, rate: 13, spread: 0.026, kind: 'turret' },
      dual: { name: '雙砲塔', w: 28, rate: 15, spread: 0.03, kind: 'dual' },
      wide: { name: '固定式全寬滾筒', w: 18, rate: 17, spread: 0.03, kind: 'wide', desc: '射擊時要轉車頭對準' },
      fixed: { name: '固定式單輪', w: 9, rate: 8, spread: 0.035, kind: 'fixed', desc: '射擊時要轉車頭對準' },
    },
  },
  climber: {
    label: '攀爬',
    options: {
      l1: { name: 'L1 掛鉤', w: 5, max: 1, rate: 0.5 },
      none: { name: '不爬', w: 0, max: 0, rate: 0.45 },
      l2: { name: 'L2 伸縮臂', w: 11, max: 2, rate: 0.42 },
      l3: { name: 'L3 多段爬升', w: 17, max: 3, rate: 0.35 },
    },
  },
};

export const PAINT = { silver: 0x8c939c, black: 0x1b1d22, blue: 0x1f5fd6, red: 0xb3262e, green: 0x2f9e5b, orange: 0xe07a1f, purple: 0x7b4bd1, gold: 0xc9a227 };
export const PAINT_NAMES = { silver: '鋁色', black: '黑', blue: '藍', red: '紅', green: '綠', orange: '橘', purple: '紫', gold: '金' };

export function defaultBuild() {
  const parts = {};
  for (const [slot, s] of Object.entries(SLOTS)) parts[slot] = Object.keys(s.options)[0];
  return { id: Date.now().toString(36), name: '我的機器人', color: 'silver', parts };
}

export const partsOf = (b) => Object.fromEntries(Object.keys(SLOTS).map((slot) => [slot, SLOTS[slot].options[b.parts[slot]] || Object.values(SLOTS[slot].options)[0]]));
export const weight = (b) => (b.adv ? advanced(b.adv).weight : Object.values(partsOf(b)).reduce((s, o) => s + o.w, 0));
export const presetKey = (b) => `custom-${b.id}`;

// Build -> robot preset (same shape as ROBOT_PRESETS entries).
export function compile(b) {
  const p = b.adv ? advanced(b.adv).preset : simple(b);
  return { ...p, model: 'custom', custom: true, name: b.name || '我的機器人', accent: PAINT[b.color] ?? PAINT.silver };
}

function simple(b) {
  const P = partsOf(b), w = weight(b);
  const { halfL, halfW } = P.frame;
  const round = P.frame.shape === 'round';
  // Hopper volume grows with the frame's floor area.
  const area = round ? Math.PI * halfL * halfL : 4 * halfL * halfW;
  const cap = Math.round(P.hopper.cap * area / (4 * 0.435 * 0.435));
  const H = P.hopper.height;
  // Lighter robots accelerate a bit harder.
  const light = 1 + 0.25 * Math.max(0, WEIGHT_LIMIT - w) / WEIGHT_LIMIT;
  const kind = P.shooter.kind;
  const rear = -halfL + 0.16;
  const turrets = kind === 'dual' ? [{ x: 0.02, z: halfW * 0.45, y: H }, { x: 0.02, z: -halfW * 0.45, y: H }]
    : kind === 'wide' ? [{ x: rear, z: 0, y: H - 0.04, fixed: Math.PI, width: halfW * 0.62 }]
      : kind === 'fixed' ? [{ x: rear, z: 0, y: H - 0.04, fixed: Math.PI }]
        : [{ x: -0.08, z: 0, y: H }];
  const desc = Object.entries(SLOTS).map(([slot, s]) => `${s.label}：${P[slot].name}`).join('、');
  return {
    build: { ...b.parts, wheels: kind === 'turretFast' ? 2 : 1 },
    shape: round ? 'round' : 'rect', halfL, halfW: round ? halfL : halfW,
    maxSpeed: P.drive.speed, accel: +(P.drive.accel * light).toFixed(2), maxOmega: P.drive.omega * (P.frame.omega || 1),
    capacity: cap, fireRate: P.shooter.rate, spread: P.shooter.spread,
    intakeW: +(halfW * P.intake.width).toFixed(3), intakeDeploy: P.intake.deploy, intakeRate: P.intake.rate,
    fitsTrench: P.hopper.trench, height: H, climbMax: P.climber.max, climbRate: P.climber.rate,
    turrets, weight: w, desc: `${desc}。`,
  };
}

// ---------- Advanced builds: dimensions, gearing and shooter settings as numbers ----------
// Limits from the 2026 game manual: frame perimeter 110 in, height 30 in, 12 in extension past the
// frame, 115 lb, and the TRENCH is 22.25 in tall.
export const RULES = { perimeter: 110, height: 30, extension: 12, trench: 22.25 };
const IN = 0.0254;

export const MOTORS = {
  kraken: { name: 'Kraken X60', rpm: 6000, torque: 1, w: 1.2 },
  vortex: { name: 'NEO Vortex', rpm: 6784, torque: 0.75, w: 1.3 },
  neo: { name: 'NEO', rpm: 5676, torque: 0.6, w: 0.9 },
};
// Indexers: how fast they can feed the shooters (balls/s total), weight, and hopper space they use.
export const INDEXERS = {
  belt: { name: '輸送帶', feed: 14, w: 4, space: 1, desc: '可靠、通用' },
  spindexer: { name: '旋轉盤（spindexer）', feed: 20, w: 7, space: 0.9, desc: '送球快，佔一些空間' },
  floor: { name: '地板滾輪床', feed: 26, w: 9, space: 0.95, desc: '最快，適合寬滾筒或多砲塔' },
  serializer: { name: '漏斗單列', feed: 9, w: 2, space: 1, desc: '最輕，但送球慢' },
};
export const DIRS = { rear: { name: '朝後', a: Math.PI }, left: { name: '朝左', a: Math.PI / 2 }, right: { name: '朝右', a: -Math.PI / 2 } };

// Slider ranges for the editor: [min, max, step].
export const RANGES = {
  length: [18, 36, 0.5], width: [18, 36, 0.5], diameter: [20, 35, 0.5], ratio: [4.5, 9, 0.05],
  intakeWidth: [8, 36, 0.5], intakeExt: [0, 12, 0.5], intakeRpm: [1500, 5000, 100],
  hopperHeight: [10, 30, 0.5], rpm: [2500, 5500, 50], shooterWidth: [4, 30, 0.5], climbSpeed: [0.3, 0.6, 0.01],
};

export function defaultAdvanced() {
  return {
    shape: 'rect', length: 27, width: 27, diameter: 28, drive: 'swerve', motor: 'kraken', ratio: 6.75,
    intakeWidth: 22, intakeExt: 10, intakeRpm: 3000, hopperHeight: 19, expand: false, indexer: 'belt',
    shooterType: 'turret', wheels: 2, rpm: 3800, fixedDir: 'rear', shooters: [{ x: -4, z: 0, width: 18 }],
    climb: 1, climbSpeed: 0.45,
  };
}

// Advanced build -> { preset, weight, parts: [[label, lb]], errors: [text], range }.
export function advanced(a) {
  const round = a.shape === 'round';
  const L = round ? a.diameter ?? 28 : a.length, W = round ? a.diameter ?? 28 : a.width;
  const perim = round ? Math.PI * L : 2 * (L + W);
  const halfL = L * IN / 2 + 0.085, halfW = W * IN / 2 + 0.085;   // plus bumpers
  const fixed = a.shooterType === 'fixed';
  const n = Math.max(1, Math.min(3, a.shooters.length));
  const shooters = a.shooters.slice(0, n);
  const motor = MOTORS[a.motor] || MOTORS.kraken, idx = INDEXERS[a.indexer] || INDEXERS.belt;
  const mecanum = a.drive === 'mecanum';
  const turretTop = fixed ? 0 : 3;
  const H = a.hopperHeight + turretTop, Hext = a.hopperHeight + (a.expand ? 8 : 0);

  // Weight (lb).
  const parts = [
    ['底盤與電控', perim * 0.12 + (round ? Math.PI * L * L / 4 : L * W) * 0.005 + 12],
    ['驅動', mecanum ? 4 * 3 + 4 * motor.w : 4 * 5 + 8 * motor.w],
    ['Intake', 2 + a.intakeWidth * 0.18 + a.intakeExt * 0.35 + (a.intakeRpm > 3500 ? 1.5 : 0)],
    ['Hopper', perim * a.hopperHeight * 0.004 + (a.expand ? 5 : 0)],
    ['Indexer', idx.w],
    ['射手', shooters.reduce((s, sh) => s + (fixed ? 3 + sh.width * 0.4 : 8 + a.wheels * 1.5), 0)],
    ['攀爬', [0, 4, 9, 14][a.climb] * (0.8 + a.climbSpeed)],
  ].map(([k, v]) => [k, Math.round(v * 10) / 10]);
  const w = Math.round(parts.reduce((s, [, v]) => s + v, 0) * 10) / 10;

  // Drive: gearing trades top speed for acceleration (until the wheels slip).
  const mass = w + 25;   // bumpers and battery
  let speed = (motor.rpm / 60) * Math.PI * 4 * IN / a.ratio * 0.95;
  let accel = Math.min(12.5, 12 * (a.ratio / 6.75) ** 2 * motor.torque * 140 / mass);
  const rmod = Math.hypot(L / 2 - 2.5, W / 2 - 2.5) * IN;
  let omega = speed * 0.7 / Math.max(0.2, rmod);
  if (mecanum) { speed *= 0.85; accel *= 0.75; omega *= 0.8; }

  // Hopper: capacity from the free floor area and wall height.
  const floor = round ? Math.PI * L * L / 4 * 0.75 : (L - 2 - (fixed && a.fixedDir === 'rear' ? 8 : 0) - (a.intakeExt === 0 ? 6 : 0)) * (W - 2);
  const cap = Math.max(5, Math.round(floor * Math.max(1, Hext - 5) * 0.006 * idx.space - (fixed ? 0 : 4 * n)));

  // Shooters: turrets fire 7 or 10 balls/s each, drums about 0.7/s per inch of width; the indexer caps it.
  const demand = shooters.reduce((s, sh) => s + (fixed ? sh.width * 0.7 : a.wheels === 2 ? 10 : 7), 0);
  const fireRate = Math.round(Math.min(demand, idx.feed) * 10) / 10;
  const spread = (fixed ? 0.03 : a.wheels === 2 ? 0.026 : 0.03) * (1 + Math.max(0, a.rpm - 3600) / 2000 * 0.6);
  const shotSpeed = a.rpm * 0.0024;
  const dir = DIRS[a.fixedDir]?.a ?? Math.PI;
  const turrets = shooters.map((sh) => ({
    x: sh.x * IN, z: sh.z * IN, y: fixed ? H * IN - 0.04 : H * IN,
    ...(fixed ? { fixed: dir, width: sh.width * IN / 2 } : {}),
  }));

  const errors = [];
  if (perim > RULES.perimeter + 1e-6) errors.push(`框架周長 ${perim.toFixed(1)} in，超過 ${RULES.perimeter} in`);
  if (Math.max(H, Hext) > RULES.height) errors.push(`高度 ${Math.max(H, Hext).toFixed(1)} in，超過 ${RULES.height} in`);
  if (a.intakeWidth > W) errors.push(`Intake 寬 ${a.intakeWidth} in，比底盤寬 ${W} in 還寬`);
  if (fixed && shooters.reduce((s, sh) => s + sh.width, 0) > (a.fixedDir === 'rear' ? W : L)) errors.push('固定式滾筒加起來比車身還寬');
  if (w > WEIGHT_LIMIT) errors.push(`超重 ${(w - WEIGHT_LIMIT).toFixed(1)} lb`);

  const preset = {
    build: { drive: mecanum ? 'mecanum' : 'swerve', hopper: a.expand ? 'expand' : 'fixed', climber: ['none', 'l1', 'l2', 'l3'][a.climb], wheels: a.wheels },
    shape: round ? 'round' : 'rect', halfL, halfW: round ? halfL : halfW,
    maxSpeed: +speed.toFixed(2), accel: +accel.toFixed(2), maxOmega: +omega.toFixed(2),
    capacity: cap, fireRate, spread: +spread.toFixed(4), shotSpeed: +shotSpeed.toFixed(2),
    intakeW: Math.min(halfW - 0.05, a.intakeWidth * IN / 2), intakeDeploy: a.intakeExt * IN, intakeRate: Math.round(6 + a.intakeRpm / 250),
    fitsTrench: H <= RULES.trench - 0.25, height: H * IN, climbMax: a.climb, climbRate: a.climbSpeed,
    turrets, weight: w,
    desc: `${round ? `圓形 ${L} in` : `${L}×${W} in`}、${mecanum ? 'Mecanum' : 'Swerve'} ${motor.name} 齒比 ${a.ratio}、${n} 座${fixed ? '固定式滾筒' : '砲塔'} ${a.rpm} RPM、${idx.name}。`,
  };
  return { preset, weight: w, parts, errors, perim, height: Math.max(H, Hext) };
}

// Make builds pickable by preset key (main thread and workers).
export function registerBuilds(builds) {
  for (const b of builds) ROBOT_PRESETS[presetKey(b)] = compile(b);
}

const KEY = 'simbotics.builds';
export function loadBuilds() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveBuilds(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}
