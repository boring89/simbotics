// Field dimensions and game constants for the 2026 FRC game (REBUILT).
// Units: metres, seconds. World axes: x = field length, z = field width, y = up.
// Red alliance wall is at +x, blue at -x. The field is rotationally symmetric.

export const FIELD_L = 16.541;
export const FIELD_W = 8.096;        // 318.75 in (field manual 3.2: 26 ft 6-3/4 in)
export const HL = FIELD_L / 2;
export const HW = FIELD_W / 2;
export const G = 9.81;

export const BALL_R = 0.075;

export const HUB_X = 3.65;          // |x| of each HUB centre
export const HUB_HALF = 0.597;      // 47 in square
export const HUB_TOP = 1.83;        // 72 in opening height
export const HUB_OPEN_R = 0.53;     // opening radius
export const ZONE_X = HL - 4.03;    // alliance zone starts at |x| > ZONE_X

// Measured from the field manual's AprilTag layout (fig. 3-36).
export const BUMP = { depth: 1.128, zMin: HUB_HALF, zMax: 2.7, h: 0.165 };
export const TRENCH = { arm: 0.12, zMin: 2.7, zMax: HW, clear: 0.565 };
export const LANES = [-3.37, -1.65, 1.65, 3.37];   // z of lanes that cross a HUB line
export const TRENCH_LANES = [-3.37, 3.37];

// Positions below are in "red-local" coordinates. For blue, negate both x and z.
// TOWER: baseplate from the wall out to the uprights; rungs run parallel to the wall.
export const TOWER = { x: HL - 1.06, z: -0.3, rungHalf: 0.55, uprightHalf: 0.4, rungs: [0.686, 1.143, 1.6] };
export const DEPOT = { x0: HL - 0.67, x1: HL - 0.02, z0: 1.38, z1: 2.42 };
// OUTPOST sits behind the alliance wall; FUEL comes through an opening at z.
export const OUTPOST = { z: -3.34, halfW: 0.36, depth: 0.73 };

export const TIMING = { countdown: 3, auto: 20, pause: 3, transition: 10, shift: 25, endgame: 30 };
export const TELEOP = TIMING.transition + 4 * TIMING.shift + TIMING.endgame; // 140
export const HUB_GRACE = 3;   // fuel still counts this long after a HUB goes inactive

export const SCORE = { fuel: 1, autoL1: 15, levels: [0, 10, 20, 30] };
export const RP = { energized: 100, supercharged: 360, traversal: 50 };

export const STAGE = { neutralCols: 12, neutralRows: 30, depot: 24, outpost: 24, preload: 8 };

// Robot presets. Dimensions are half extents of the bumpers (halfL along the drive "front").
// turrets: shooter exits in robot-local metres; `fixed` = yaw locked to the chassis (radians).
// Real 2026 robots use published details where they exist; the rest are estimates.
const GENERIC = { model: 'generic', shape: 'rect', halfL: 0.435, halfW: 0.435, intakeW: 0.33, intakeDeploy: 0, turrets: [{ x: -0.1, z: 0 }] };

export const ROBOT_PRESETS = {
  overload: {
    ...GENERIC, model: 'overload', team: 254, real: true, name: '254 Overload',
    maxSpeed: 4.6, accel: 11, maxOmega: 6.5, capacity: 72, fireRate: 16, spread: 0.03,
    fitsTrench: true, height: 0.56, climbMax: 1, climbRate: 0.45,
    halfL: 0.5, halfW: 0.41, intakeW: 0.38, intakeDeploy: 0.28,
    turrets: [{ x: -0.36, z: 0, y: 0.5, fixed: Math.PI, width: 0.28 }],
    desc: 'MK5n swerve、直線伸出的全寬 intake、可裝 70+ 顆的網狀 hopper、全寬滾筒射手（可調 hood，固定式：射擊時自動轉車頭瞄準）。',
  },
  kepler: {
    ...GENERIC, model: 'kepler', team: 1690, real: true, name: '1690 Kepler',
    maxSpeed: 4.8, accel: 12, maxOmega: 7.5, capacity: 50, fireRate: 13, spread: 0.022,
    fitsTrench: true, height: 0.46, climbMax: 1, climbRate: 0.5,
    halfL: 0.43, halfW: 0.45, intakeW: 0.4,
    turrets: [{ x: -0.14, z: 0.2 }],
    desc: 'Swerve、多滾輪高速 intake、齒輪傳動砲塔射手（約 13 顆/秒）、可邊跑邊射、鑽 TRENCH、L1。容量為估計值。',
  },
  alphadogs: {
    ...GENERIC, model: 'alphadogs', team: 4946, real: true, name: '4946 The Alpha Dogs',
    maxSpeed: 4.4, accel: 10, maxOmega: 7, capacity: 45, fireRate: 10, spread: 0.028,
    fitsTrench: true, height: 0.58, climbMax: 1, climbRate: 0.45,
    shape: 'round', halfL: 0.46, halfW: 0.46, intakeW: 0.27,
    turrets: [{ x: 0, z: 0, y: 0.6 }],
    desc: '圓形底盤與彎曲木層板 bumper、旋轉 dye rotor 送球、中央塔式砲塔（滑環可無限旋轉）。速度、容量、攀爬為估計值。',
  },
  artemis: {
    ...GENERIC, model: 'artemis', team: 118, real: true, name: '118 Artemis',
    maxSpeed: 4.4, accel: 10, maxOmega: 6.5, capacity: 60, fireRate: 14, spread: 0.03,
    fitsTrench: false, height: 0.78, climbMax: 1, climbRate: 0.45,
    halfL: 0.45, halfW: 0.42, intakeW: 0.36,
    turrets: [{ x: 0.2, z: 0.19, y: 0.36 }, { x: 0.2, z: -0.19, y: 0.36 }],
    desc: '雙砲塔（Kraken X44 射輪 + hood 滾輪、伺服調 hood）、高大透明 hopper、中央 L1。容量、高度為估計值。',
  },
  ripcurrent: {
    ...GENERIC, model: 'ripcurrent', team: 4414, real: true, name: '4414 RIPCURRENT',
    maxSpeed: 4.7, accel: 11.5, maxOmega: 7, capacity: 55, fireRate: 15, spread: 0.02,
    fitsTrench: true, height: 0.56, climbMax: 1, climbRate: 0.45,
    halfL: 0.44, halfW: 0.44, intakeW: 0.36,
    turrets: [{ x: -0.05, z: 0, y: 0.58 }],
    desc: '2026 世界冠軍。外板與 bumper 一體化、dolphin tail dye rotor、扁平「pancake」高速砲塔。速度、容量、攀爬為估計值。',
  },
  balanced: {
    ...GENERIC, name: 'Balanced Swerve', maxSpeed: 4.3, accel: 10, maxOmega: 7, capacity: 40,
    fireRate: 8, spread: 0.035, fitsTrench: true, height: 0.52, climbMax: 3, climbRate: 0.45,
    desc: '砲塔射手，40 顆 FUEL 容量，能鑽 TRENCH，可爬 L3。',
  },
  shuttle: {
    ...GENERIC, name: 'Speedy Shuttle', maxSpeed: 5.0, accel: 12, maxOmega: 8, capacity: 25,
    fireRate: 6, spread: 0.06, fitsTrench: true, height: 0.45, climbMax: 1, climbRate: 0.5,
    desc: '速度快、靈活，容量小，只能爬 L1。',
  },
  hopper: {
    ...GENERIC, name: 'Heavy Hopper', maxSpeed: 3.7, accel: 7.5, maxOmega: 5.5, capacity: 70,
    fireRate: 12, spread: 0.045, fitsTrench: false, height: 0.74, climbMax: 3, climbRate: 0.35,
    desc: '超大容量、射速快，太高鑽不過 TRENCH，可爬 L3。',
  },
};

// tactics: 0 = simple collect/score loop, 1 = stockpile + feeder/defender tactics when chosen,
// 2 = roles by shift, defense, pre-shooting, cluster picking, 3 = full Einstein playbook.
export const BOT_SKILL = {
  easy:     { name: '簡單', speed: 0.65, spread: 2.0, climb: 1, reaction: 0.8, tactics: 0 },
  medium:   { name: '普通', speed: 0.85, spread: 1.3, climb: 2, reaction: 0.4, tactics: 1 },
  hard:     { name: '困難', speed: 0.95, spread: 1.0, climb: 3, reaction: 0.2, tactics: 2 },
  einstein: { name: '愛因斯坦', speed: 1.0, spread: 0.8, climb: 3, reaction: 0.08, tactics: 3 },
  // Same playbook as Einstein, but the robots drive, intake and shoot 50% faster than their spec.
  legend:   { name: '傳奇（性能 +50%）', speed: 1.2, spread: 0.6, climb: 3, reaction: 0.05, tactics: 3, boost: 1.5 },
};

export const COLORS = {
  red: 0xe5303b, blue: 0x2f6fe4, fuel: 0xf6d31c,
  redDark: 0x7a1a20, blueDark: 0x1a3a7a,
};

export const side = (alliance) => (alliance === 'red' ? 1 : -1);
export const other = (alliance) => (alliance === 'red' ? 'blue' : 'red');

// Smooth bump profile; robots and FUEL both ride over it.
export function groundHeight(x, z) {
  const az = Math.abs(z);
  if (az <= BUMP.zMin || az >= BUMP.zMax) return 0;
  const u = Math.abs(Math.abs(x) - HUB_X) / (BUMP.depth / 2);
  if (u >= 1) return 0;
  const t = Math.min(1, (1 - u) / 0.55);
  return BUMP.h * t * t * (3 - 2 * t);
}
