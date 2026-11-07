import { ROBOT_PRESETS } from './config.js';
import { defaultAdvanced, PAINT } from './parts.js';

// The 2026 season snapshot (data/2026.json, made by scripts/fetch_season.py from Statbotics, whose
// event data comes from The Blue Alliance): every team with its EPA and every event's roster.
// Teams without a modelled robot get an advanced build generated from their EPA.

let DATA = null, EPAS = null;

export async function loadSeason() {
  if (DATA) return DATA;
  const res = await fetch(new URL('../data/2026.json', import.meta.url));
  DATA = await res.json();
  DATA.byKey = Object.fromEntries(DATA.events.map((e) => [e.key, e]));
  EPAS = Object.values(DATA.teams).map((t) => t[1]).sort((a, b) => a - b);
  return DATA;
}
export const season = () => DATA;
export const eventByKey = (k) => DATA.byKey[k];

export const DISTRICTS = {
  fim: '密西根', ca: '加州', ne: '新英格蘭', fit: '德州', fma: '中大西洋', pnw: '太平洋西北', ont: '安大略',
  fch: '切薩皮克', fnc: '北卡羅來納', pch: '喬治亞（Peachtree）', fin: '印第安納', isr: '以色列', win: '威斯康辛', fsc: '南卡羅來納',
};

export function teamInfo(n) {
  const t = DATA?.teams[n];
  if (!t) return null;
  const [name, epa, district, state, autoFuel, teleFuel, tower, rookie] = t;
  return { number: +n, name, epa, district, state, autoFuel, teleFuel, tower, rookie };
}

// Share of all teams with a lower EPA (0..1).
export function percentile(epa) {
  let lo = 0, hi = EPAS.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (EPAS[mid] < epa) lo = mid + 1; else hi = mid; }
  return lo / EPAS.length;
}

export const eventsOf = (type, district) => DATA.events.filter((e) => e.type === type && (district === undefined || e.district === district));
export const dateOf = (e) => new Date(`${e.start}T12:00:00`);

const hash = (n) => { let x = n * 2654435761 >>> 0; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; };
const SKILLS = ['easy', 'medium', 'hard', 'einstein'];

// A team's robot for the sim: its real preset if we have one, else a build shaped by its EPA.
// Returns { preset, skill, build? } where build is an advanced build to register.
export function teamRobot(n) {
  n = +n;
  const real = Object.entries(ROBOT_PRESETS).find(([, p]) => p.real && p.team === n);
  if (real) return { preset: real[0], skill: 'einstein' };
  const t = teamInfo(n) || { epa: 20, tower: 0, name: '' };
  const q = percentile(t.epa), r = hash(n);
  const skill = SKILLS[q < 0.3 ? 0 : q < 0.62 ? 1 : q < 0.9 ? 2 : 3];
  const a = defaultAdvanced();
  const L = 24 + Math.round(r() * 8) / 2, W = Math.min(28, 55 - L);
  Object.assign(a, {
    shape: r() < 0.05 ? 'round' : 'rect', length: L, width: W, diameter: 27,
    drive: q > 0.15 || r() < 0.6 ? 'swerve' : 'mecanum', motor: q > 0.5 ? 'kraken' : r() < 0.5 ? 'vortex' : 'neo',
    ratio: 6.12 + Math.round(r() * 12) * 0.05,
    intakeWidth: Math.min(W - 2, Math.round(12 + q * 13)), intakeExt: q > 0.3 ? 8 + Math.round(r() * 4) : Math.round(r() * 6),
    intakeRpm: Math.round((2400 + q * 2200) / 100) * 100,
    hopperHeight: r() < 0.15 ? 25 : Math.round((13 + q * 7) * 2) / 2, expand: q > 0.6 && r() < 0.3,
    indexer: q > 0.8 ? (r() < 0.5 ? 'floor' : 'spindexer') : q > 0.35 ? 'belt' : 'serializer',
    wheels: q > 0.45 ? 2 : 1, rpm: Math.round((2900 + q * 1400) / 50) * 50,
    climb: t.tower >= 18 ? 3 : t.tower >= 9 ? 2 : t.tower >= 3 ? 1 : 0, climbSpeed: 0.4 + Math.round(r() * 10) / 100,
  });
  if (q > 0.7 && r() < 0.35) {
    a.shooterType = 'fixed'; a.fixedDir = 'rear';
    a.shooters = [{ x: -(L / 2 - 4), z: 0, width: Math.min(W - 4, 16 + Math.round(q * 6)) }];
  } else {
    a.shooterType = 'turret';
    a.shooters = q > 0.85 && r() < 0.4 ? [{ x: -4, z: W / 4, width: 18 }, { x: -4, z: -W / 4, width: 18 }] : [{ x: -4, z: 0, width: 18 }];
  }
  const colors = Object.keys(PAINT);
  const build = { id: `t${n}`, name: (t.name || `Team ${n}`).slice(0, 40), color: colors[Math.floor(r() * colors.length)], adv: a };
  return { preset: `custom-t${n}`, skill, build };
}
