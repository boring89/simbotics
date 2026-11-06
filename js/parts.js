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
export const weight = (b) => Object.values(partsOf(b)).reduce((s, o) => s + o.w, 0);
export const presetKey = (b) => `custom-${b.id}`;

// Build -> robot preset (same shape as ROBOT_PRESETS entries).
export function compile(b) {
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
    model: 'custom', custom: true, name: b.name || '我的機器人', build: b.parts, accent: PAINT[b.color] ?? PAINT.silver,
    shape: round ? 'round' : 'rect', halfL, halfW: round ? halfL : halfW,
    maxSpeed: P.drive.speed, accel: +(P.drive.accel * light).toFixed(2), maxOmega: P.drive.omega * (P.frame.omega || 1),
    capacity: cap, fireRate: P.shooter.rate, spread: P.shooter.spread,
    intakeW: +(halfW * P.intake.width).toFixed(3), intakeDeploy: P.intake.deploy, intakeRate: P.intake.rate,
    fitsTrench: P.hopper.trench, height: H, climbMax: P.climber.max, climbRate: P.climber.rate,
    turrets, weight: w, desc: `${desc}。`,
  };
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
