// Career mode catalogs: workshops, machines, materials, vendors and their stock, and the parts a
// robot design breaks down into. Plain data and pure functions only (no DOM, no three.js).

export const KICKOFF = new Date('2026-01-10T00:00:00');
export const DAY = 1440;                        // minutes
export const START_T = 13 * 60;                 // kickoff day, after the broadcast

export const dayOf = (t) => Math.floor(t / DAY);
export const minOf = (t) => ((t % DAY) + DAY) % DAY;
export const dateOf = (t) => new Date(KICKOFF.getTime() + dayOf(t) * 864e5);
export const weekend = (t) => [0, 6].includes(dateOf(t).getDay());
export const fmtDate = (t) => { const d = dateOf(t); return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`; };
export const fmtClock = (t) => { const m = minOf(t); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`; };
export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

// ---------- Workshops ----------
// open: [from, to] minutes on weekdays / weekends. Students come after school and on weekends.
export const SHOPS = {
  garage: {
    name: '車庫', desc: '空間小、只有手工具，但隨時都能進來做。', size: [11, 7.5], slots: 4,
    open: { weekday: [7 * 60, 24 * 60], weekend: [7 * 60, 24 * 60] }, machines: {}, money: 1000,
  },
  school: {
    name: '學校教室', desc: '中等空間，有一台台鑽。平日放學後和週末白天才能用。', size: [15, 10], slots: 7,
    open: { weekday: [15 * 60, 21 * 60], weekend: [9 * 60, 18 * 60] }, machines: { drill: 1 }, money: 0,
  },
  factory: {
    name: '贊助商工廠', desc: '大空間、機台多（台鑽、帶鋸、車床），要配合工廠作息：平日只有晚上能用。', size: [20, 12], slots: 10,
    open: { weekday: [17 * 60, 22 * 60], weekend: [8 * 60, 20 * 60] }, machines: { drill: 1, band: 1, lathe: 1 }, money: 0,
  },
};
export const CREW_HOURS = { weekday: [15 * 60, 21 * 60], weekend: [9 * 60, 19 * 60] };

// ---------- Machines and tools ----------
export const MACHINES = {
  drill: { name: '台鑽', cost: 450, max: 2, desc: '鑽孔。手工做鋁件一定要有。' },
  band: { name: '帶鋸機', cost: 900, max: 2, desc: '切方管、切板材、切軸。' },
  lathe: { name: '桌上型車床', cost: 3200, max: 1, desc: '車軸、墊片、輪軸。' },
  cnc: { name: 'CNC 路由機', cost: 6500, max: 1, desc: '自動切鋁板和聚碳酸酯板，又快又準。' },
  printer: { name: '3D 印表機', cost: 900, max: 3, desc: '列印 hood、馬達座、相機座等塑膠件。' },
};
// Consumable tooling, with what you start with.
export const TOOLS = {
  bits: { name: '鑽頭組', cost: 40, start: 3, desc: '台鑽用。下鑽太快或不退屑會斷。' },
  endmill: { name: 'CNC 端銑刀', cost: 35, start: 1, desc: 'CNC 用。進給太快或撞到夾具會斷。' },
  blade: { name: '帶鋸條', cost: 28, start: 1, desc: '送料太猛會斷。' },
  tap: { name: '螺絲攻組', cost: 25, start: 2, desc: '攻牙時不倒轉斷屑容易斷。' },
  insert: { name: '車刀刀片', cost: 30, start: 2, desc: '車床用。吃刀太深或沒開主軸就碰工件會崩。' },
};

// ---------- Vendors (fictional) ----------
export const VENDORS = {
  andymart: { name: 'AndyMart', tag: 'FRC 零件百貨：控制器、電池、bumper、輪子', color: '#e8590c', ship: 3 },
  pacific: { name: 'Pacific Parts Co.', tag: '鋁材、軸承、皮帶與傳動件', color: '#1864ab', ship: 4 },
  swivel: { name: 'Swivel Drive Supply', tag: 'Swerve 模組專賣', color: '#2b8a3e', ship: 7 },
  riv: { name: 'RIV Robotics', tag: 'NEO 馬達、SPARK 控制器、減速箱', color: '#e67700', ship: 4 },
  ctrx: { name: 'CTRx Electronics', tag: 'Kraken 馬達與 CAN 感測器', color: '#5f3dc4', ship: 5 },
  maker: { name: 'MakerMart 機具城', tag: '加工機具與耗材', color: '#c92a2a', ship: 5 },
  kop: { name: 'Kickoff 套件', tag: '每隊在 Kickoff 領到的套件', color: '#555', ship: 0, hidden: true },
  quickcut: { name: 'QuickCut 代工', tag: '上傳圖檔，雷射切割、CNC、車削代工', color: '#0b7285', ship: 6 },
};
export const SHIPPING = { fee: 15, free: 300 };

export const MATERIALS = {
  tube2x1: { name: '2×1 in 鋁方管（60 in）', vendor: 'pacific', cost: 28 },
  tube1x1: { name: '1×1 in 鋁方管（60 in）', vendor: 'pacific', cost: 18 },
  plate18: { name: '1/8 in 鋁板（24×24 in）', vendor: 'pacific', cost: 55 },
  plate14: { name: '1/4 in 鋁板（12×24 in）', vendor: 'pacific', cost: 60 },
  poly: { name: '1/8 in 聚碳酸酯板（24×48 in）', vendor: 'andymart', cost: 48 },
  hex: { name: '1/2 in 六角軸（36 in）', vendor: 'riv', cost: 22 },
  round: { name: '1-1/8 in 鋁圓棒（12 in）', vendor: 'pacific', cost: 16 },
  filament: { name: 'PETG 線材（1 kg）', vendor: 'andymart', cost: 25 },
};

export const COTS = {
  swerve: { name: 'MK5 Swivel 模組（不含馬達）', vendor: 'swivel', cost: 480 },
  mecanum: { name: 'Mecanum 輪組（4 輪）', vendor: 'andymart', cost: 380 },
  kraken: { name: 'Kraken X60 馬達（內建控制器）', vendor: 'ctrx', cost: 200 },
  vortex: { name: 'NEO Vortex 馬達', vendor: 'riv', cost: 160 },
  neo: { name: 'NEO 馬達', vendor: 'riv', cost: 110 },
  spark: { name: 'SPARK 馬達控制器', vendor: 'riv', cost: 90 },
  encoder: { name: 'CAN 絕對編碼器', vendor: 'ctrx', cost: 60 },
  imu: { name: 'Dove 2 陀螺儀', vendor: 'ctrx', cost: 200 },
  core: { name: 'roboCore 主控制器', vendor: 'andymart', cost: 480 },
  pdh: { name: '電源分配板 PDH', vendor: 'riv', cost: 250 },
  radio: { name: '機器人無線電', vendor: 'andymart', cost: 180 },
  battery: { name: '12V 機器人電池', vendor: 'andymart', cost: 120 },
  wiring: { name: '電線、端子與接頭包', vendor: 'andymart', cost: 90 },
  bearings: { name: '軸承包（20 個）', vendor: 'pacific', cost: 60 },
  belts: { name: '皮帶與滑輪組', vendor: 'pacific', cost: 110 },
  gearbox: { name: '行星減速箱', vendor: 'riv', cost: 180 },
  wheels: { name: '飛輪與滾輪組', vendor: 'andymart', cost: 90 },
  compliant: { name: '柔性輪（10 個）', vendor: 'andymart', cost: 70 },
  turret: { name: '轉台軸承', vendor: 'pacific', cost: 260 },
  bolts: { name: '螺絲、螺帽與鉚釘包', vendor: 'pacific', cost: 45 },
  bumper: { name: 'Bumper 布料、木板與泡棉', vendor: 'andymart', cost: 220 },
};

// ---------- Subsystems ----------
// detail: design hours before its parts can be made; build: assembly hours.
export const SUBS = {
  frame: { name: '底盤', detail: 12, build: 14 },
  drive: { name: '驅動', detail: 8, build: 14 },
  intake: { name: 'Intake', detail: 12, build: 10 },
  hopper: { name: 'Hopper／Indexer', detail: 9, build: 10 },
  shooter: { name: '射球', detail: 18, build: 12 },
  climber: { name: '攀爬', detail: 9, build: 8 },
  controls: { name: '電控', detail: 8, build: 18 },
  bumpers: { name: 'Bumper', detail: 3, build: 10 },
};
export const SUB_ORDER = Object.keys(SUBS);
export const PROGRAM_HOURS = 30;

// ---------- Ways to make a part ----------
// Each method is a list of operations; each operation runs on a station.
export const STATIONS = { band: '帶鋸機', drill: '台鑽', lathe: '車床', cnc: 'CNC', printer: '3D 印表機', bench: '工作台' };
export const METHODS = {
  manual: { name: '手工（帶鋸＋台鑽）', ops: ['band', 'drill', 'bench'], cap: 0.9 },
  cnc: { name: 'CNC', ops: ['cnc', 'bench'], cap: 1 },
  saw: { name: '帶鋸＋攻牙', ops: ['band', 'bench'], cap: 0.92 },
  lathe: { name: '車床', ops: ['lathe'], cap: 0.98 },
  printer: { name: '3D 列印', ops: ['printer'], cap: 0.94 },
  outsource: { name: '外包（QuickCut）', ops: [], cap: 0.96 },
};
export const KINDS = {
  tube: { name: '方管', methods: ['manual', 'cnc', 'outsource'] },
  plate: { name: '鋁板', methods: ['cnc', 'manual', 'outsource'] },
  poly: { name: '聚碳酸酯板', methods: ['cnc', 'manual', 'outsource'] },
  hex: { name: '六角軸', methods: ['saw', 'outsource'] },
  turn: { name: '車削件', methods: ['lathe', 'outsource'] },
  print: { name: '塑膠件', methods: ['printer', 'outsource'] },
};
// Labor hours per unit for a crew member of average skill at each station (CNC and printer
// are setup time; the machine then runs by itself for `run` minutes per unit).
export function opHours(p, st) {
  const s = p.spec, holes = s.holes?.length || 0;
  switch (st) {
    case 'band': return 0.5 + (p.kind === 'plate' || p.kind === 'poly' ? 0.5 : 0);
    case 'drill': return 0.3 + holes * 0.15;
    case 'bench': return p.kind === 'hex' ? 0.7 : 0.4 + holes * 0.04;
    case 'lathe': return 1.5 + s.len * 0.15;
    case 'cnc': return 1;
    case 'printer': return 0.4;
    default: return 0;
  }
}
export function runMinutes(p, st) {
  if (st === 'cnc') return Math.round(12 + (p.spec.w || 2) * (p.spec.h || p.spec.len || 2) * 0.35 + (p.spec.holes?.length || 0) * 1.5);
  if (st === 'printer') return Math.round(60 * p.spec.hours);
  return 0;
}
export const outsourceCost = (p) => Math.round((p.kind === 'turn' || p.kind === 'hex' ? 35 : p.kind === 'print' ? 30 : 25 + (p.spec.w || 2) * (p.spec.h || p.spec.len || 2) * 0.12) * p.qty);

// ---------- Design -> parts ----------
// A part: { id, sub, name, kind, qty, mat, use (material units per piece), spec }.
// spec: tube/hex { len, holes: [in from the end] }, plate/poly { w, h, holes: [[x, y]] },
//       turn { dia (stock), target, len }, print { grams, hours }.
const row = (n, a, b) => Array.from({ length: n }, (_, i) => +(a + (b - a) * (n === 1 ? 0.5 : i / (n - 1))).toFixed(2));
const grid = (w, h, nx, ny, m = 0.75) => row(nx, m, w - m).flatMap((x) => row(ny, m, h - m).map((y) => [x, y]));
const ring = (w, h, n, m = 0.75) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([+(w / 2 + Math.cos(a) * (w / 2 - m)).toFixed(2), +(h / 2 + Math.sin(a) * (h / 2 - m)).toFixed(2)]);
  }
  return pts;
};

export function partsFor(a) {
  const round = a.shape === 'round';
  const L = round ? a.diameter : a.length, W = round ? a.diameter : a.width;
  const out = [];
  const add = (sub, key, name, kind, qty, spec) => {
    const mat = { tube: spec.mat || 'tube2x1', plate: spec.mat || 'plate18', poly: 'poly', hex: 'hex', turn: 'round', print: 'filament' }[kind];
    const use = kind === 'tube' || kind === 'hex' ? spec.len / (kind === 'hex' ? 36 : 60)
      : kind === 'plate' || kind === 'poly' ? (spec.w * spec.h) / (kind === 'poly' ? 1152 : mat === 'plate14' ? 288 : 576)
        : kind === 'turn' ? spec.len / 12 : spec.grams / 1000;
    out.push({ id: `${sub}.${key}`, sub, name, kind, qty, mat, use: +(use * 1.15).toFixed(3), spec: { ...spec, mat: undefined } });
  };
  // Frame: four rails, corner gussets, belly pan, battery mount, bumper mounts.
  add('frame', 'railL', '長邊框管', 'tube', 2, { len: L - 2, holes: row(8, 1, L - 3) });
  add('frame', 'railW', '短邊框管', 'tube', 2, { len: W - 6, holes: row(6, 1, W - 7) });
  add('frame', 'gusset', '角片', 'plate', 8, { w: 4, h: 4, holes: grid(4, 4, 2, 3) });
  add('frame', 'belly', '底板', 'poly', 1, { w: L - 4, h: W - 4, holes: grid(L - 4, W - 4, 6, 4, 1) });
  add('frame', 'batt', '電池座', 'plate', 1, { w: 8, h: 4, holes: grid(8, 4, 3, 2) });
  add('frame', 'bmount', 'Bumper 掛架', 'plate', 4, { w: 3, h: 2, holes: row(3, 0.5, 2.5).map((x) => [x, 1]) });
  // Drive.
  if (a.drive === 'mecanum') {
    add('drive', 'gplate', '齒輪箱側板', 'plate', 4, { mat: 'plate14', w: 6, h: 4, holes: grid(6, 4, 3, 2) });
    add('drive', 'axle', '輪軸', 'hex', 4, { len: 5, holes: [] });
    add('drive', 'spacer', '輪軸墊片', 'turn', 4, { dia: 1.125, target: 0.75, len: 0.5 });
  } else {
    add('drive', 'mplate', '模組安裝板', 'plate', 4, { w: 5, h: 5, holes: grid(5, 5, 3, 2) });
    add('drive', 'mtop', '模組上蓋', 'plate', 4, { mat: 'plate14', w: 4, h: 4, holes: ring(4, 4, 6) });
    add('drive', 'spacer', '轉向齒輪墊片', 'turn', 4, { dia: 1.125, target: 0.875, len: 0.4 });
    add('drive', 'axle', '輪軸', 'turn', 4, { dia: 1.125, target: 0.5, len: 2.2 });
  }
  // Intake.
  add('intake', 'side', 'Intake 側板', 'plate', 2, { w: 10, h: 4, holes: grid(10, 4, 4, 2) });
  add('intake', 'roll', '滾輪軸', 'hex', Math.max(2, Math.round(a.intakeWidth / 9)), { len: a.intakeWidth + 1, holes: [] });
  add('intake', 'arm', '樞軸臂', 'tube', 2, { mat: 'tube1x1', len: 10 + a.intakeExt, holes: row(4, 0.75, 9 + a.intakeExt) });
  add('intake', 'guard', '擋板', 'poly', 1, { w: a.intakeWidth, h: 5, holes: row(5, 1, a.intakeWidth - 1).map((x) => [x, 0.6]) });
  if (a.intakeExt > 0) add('intake', 'slide', '滑軌座', 'print', 2, { grams: 45, hours: 2.5 });
  // Hopper and indexer.
  const hh = a.hopperHeight;
  add('hopper', 'wall', 'Hopper 牆板', 'poly', a.expand ? 4 : 2, { w: L - 8, h: hh, holes: row(6, 1, L - 9).map((x) => [x, 0.6]) });
  add('hopper', 'floor', 'Hopper 底板', 'poly', 1, { w: L - 8, h: W - 6, holes: grid(L - 8, W - 6, 4, 3, 1) });
  add('hopper', 'rail', '導軌', 'tube', 2, { mat: 'tube1x1', len: L - 8, holes: row(5, 1, L - 9) });
  add('hopper', 'ishaft', '送球輪軸', 'hex', a.indexer === 'floor' ? 3 : a.indexer === 'serializer' ? 1 : 2, { len: W - 6, holes: [] });
  add('hopper', 'iplate', 'Indexer 側板', 'plate', 2, { w: 8, h: 5, holes: grid(8, 5, 4, 2) });
  // Shooter(s).
  const n = a.shooters.length;
  if (a.shooterType === 'fixed') {
    const wd = Math.max(...a.shooters.map((s) => s.width));
    add('shooter', 'side', '射球側板', 'plate', 2 * n, { w: 9, h: 7, holes: ring(9, 7, 8) });
    add('shooter', 'drum', '滾筒軸', 'hex', 2 * n, { len: wd + 1, holes: [] });
    add('shooter', 'hood', 'Hood', 'print', n, { grams: 160, hours: 7 });
    add('shooter', 'mmount', '馬達座', 'print', n, { grams: 60, hours: 3 });
  } else {
    add('shooter', 'fshaft', '飛輪軸', 'turn', a.wheels * n, { dia: 1.125, target: 0.5, len: 4 });
    add('shooter', 'tbase', '轉台底盤', 'plate', n, { mat: 'plate14', w: 9, h: 9, holes: ring(9, 9, 12) });
    add('shooter', 'tring', '轉台齒圈', 'plate', n, { mat: 'plate14', w: 10, h: 10, holes: ring(10, 10, 16, 0.6) });
    add('shooter', 'side', '射球側板', 'plate', 2 * n, { w: 8, h: 6, holes: ring(8, 6, 8) });
    add('shooter', 'hood', 'Hood 板', 'print', 2 * n, { grams: 90, hours: 4.5 });
    add('shooter', 'mmount', '馬達座', 'print', n, { grams: 60, hours: 3 });
  }
  // Climber.
  if (a.climb > 0) {
    add('climber', 'arm', '攀爬手臂管', 'tube', a.climb > 1 ? 4 : 2, { mat: 'tube1x1', len: 12 + a.climb * 4, holes: row(5, 1, 11 + a.climb * 4) });
    add('climber', 'hook', '鉤爪', 'plate', 2, { mat: 'plate14', w: 4, h: 3, holes: grid(4, 3, 2, 2, 0.6) });
    add('climber', 'winch', '絞盤軸', 'turn', 1, { dia: 1.125, target: 0.625, len: 3 });
    add('climber', 'mount', '手臂固定座', 'plate', 2, { w: 4, h: 3, holes: grid(4, 3, 2, 2, 0.6) });
  }
  // Electronics.
  add('controls', 'ebrd', '電控板', 'poly', 1, { w: Math.min(L - 6, 18), h: 10, holes: grid(Math.min(L - 6, 18), 10, 5, 3) });
  add('controls', 'cam', '相機座', 'print', 2, { grams: 30, hours: 1.8 });
  add('controls', 'clip', '走線夾片', 'print', 4, { grams: 8, hours: 0.6 });
  return out;
}

// Motors a design needs, per subsystem.
export function motorsFor(a) {
  const n = a.shooters.length;
  return {
    drive: a.drive === 'mecanum' ? 4 : 8,
    intake: a.intakeExt > 0 ? 2 : 1,
    hopper: a.indexer === 'floor' ? 2 : 1,
    shooter: a.shooterType === 'fixed' ? 2 * n : (a.wheels + 1) * n,
    climber: a.climb ? (a.climb > 1 ? 2 : 1) : 0,
  };
}

// COTS installed with each subsystem.
export function cotsFor(a) {
  const m = motorsFor(a), mo = a.motor, n = a.shooters.length, neo = mo !== 'kraken';
  const total = Object.values(m).reduce((s, v) => s + v, 0);
  const c = {
    frame: { bolts: 1 },
    drive: a.drive === 'mecanum' ? { mecanum: 1, [mo]: m.drive, bearings: 1 } : { swerve: 4, [mo]: m.drive, encoder: 4, bearings: 1 },
    intake: { [mo]: m.intake, compliant: 1, belts: 1 },
    hopper: { [mo]: m.hopper, belts: 1 },
    shooter: a.shooterType === 'fixed' ? { [mo]: m.shooter, wheels: n, bearings: 1 } : { [mo]: m.shooter, wheels: n, turret: n, bearings: 1 },
    climber: a.climb ? { [mo]: m.climber, gearbox: 1 } : {},
    controls: { core: 1, pdh: 1, radio: 1, imu: 1, wiring: 1, battery: 1, ...(neo ? { spark: total } : {}) },
    bumpers: { bumper: 1 },
  };
  for (const k of Object.keys(c)) for (const [i, q] of Object.entries(c[k])) if (!q) delete c[k][i];
  return c;
}

// ---------- Crew ----------
export const ROLES = { mech: '機構', elec: '電控', prog: '程式', cad: '設計', drive: '操駕' };
export const NAMES = ['小安', '阿哲', '佳穎', '柏翰', '思妤', '冠宇', '品妍', '承恩', '子晴', '宥廷', '語彤', '家豪', '詠晴', '浩宇', '采薇', '俊傑'];
export const SHIRTS = [0x2f6fe4, 0xe0a019, 0x2f9e5b, 0xc8343c, 0x7b4bd1, 0x1f9ea6];
