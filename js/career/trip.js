import { DAY, KICKOFF, money, COTS } from './data.js';
import { advanced } from '../parts.js';
import { distance, landmass, eventPlace } from './geo.js';
import { mail, log } from './state.js';

// Getting to an event: how the robot travels, tickets and hotel, a place to test, packing, and
// what the trip does to the robot. Times are anchored to the event's first day (day D):
// the team leaves on D-2, tests on D-1, plays D..D+2 and flies home on D+3.

export const MODES = {
  land: { name: '陸運', desc: '卡車把整台機器載過去，隊員坐巴士或搭機。', ship: 3, back: 2, damage: 0.05 },
  sea: { name: '海運', desc: '貨櫃船，最便宜但最慢：機器要提早一個月出發，回程也一樣久。', ship: 30, back: 30, damage: 0.08 },
  air: { name: '行李箱／航空箱托運', desc: '機器拆開裝箱跟著飛機走，到了要重新組裝；每箱限重 32 kg，超過 23 kg 要加錢。', ship: 0, back: 0, damage: 0.14, rebuild: true },
};
export const HOTELS = [
  { name: '經濟旅館', price: 95, rest: 0.7, far: '開車 30 分鐘' },
  { name: '標準飯店', price: 150, rest: 0.85, far: '開車 15 分鐘' },
  { name: '賽場旁飯店', price: 230, rest: 1, far: '走路 5 分鐘' },
];
export const SITES = {
  none: { name: '不測試', desc: '直接去賽場，運送造成的問題要到比賽時才會發現。' },
  hotel: { name: '借飯店場地', desc: '租飯店的宴會廳或停車場（$300）。地面不是地毯，測試效果打折。', cost: 300, q: 0.6 },
  team: { name: '找當地隊伍', desc: '寫信請當地隊伍借練習場，免費、場地最好，但對方不一定答應。', q: 1 },
};
export const NIGHTS = 5;

export const startDay = (e) => Math.floor((new Date(`${e.start}T12:00:00`) - KICKOFF) / 864e5);
export const tripTimes = (e) => {
  const D = startDay(e);
  return { D, depart: (D - 2) * DAY + 8 * 60, arrive: (D - 2) * DAY + 18 * 60, test: (D - 1) * DAY + 9 * 60, home: (D + 3) * DAY + 20 * 60 };
};

// People travel by bus when it's a drive, else they fly.
export function travel(g, e) {
  const from = g.team.place, to = eventPlace(e), km = distance(from, to);
  const sameLand = landmass(from) === landmass(to);
  return { km, bus: sameLand && km <= 1200, land: sameLand, to };
}
export const travelers = (g, trip) => 1 + (trip?.crew ?? g.crew.length);

const surge = (days) => (days >= 45 ? 0.8 : days >= 21 ? 1 : days >= 10 ? 1.25 : days >= 3 ? 1.7 : 2.4);
export function ticketPrice(g, e) {
  const t = travel(g, e), days = tripTimes(e).depart / DAY - g.t / DAY;
  return Math.round(t.bus ? 30 + t.km * 0.06 : (90 + t.km * 0.11) * surge(days));
}
export function hotelPrice(g, e, i, people) {
  const days = tripTimes(e).depart / DAY - g.t / DAY;
  return Math.round(HOTELS[i].price * (days < 7 ? 1.3 : 1) * Math.ceil(people / 4) * NIGHTS);
}

// ---------- Packing ----------
// Robot plus bumpers, in kg (the design weight is in lb).
export const robotKg = (g) => (g.design ? Math.round((advanced(g.design.adv).weight + 15) * 0.454) : 0);
export function packList(g) {
  const items = [
    { key: 'robot', name: '機器人', kg: robotKg(g), max: g.design ? 1 : 0, need: true },
    { key: 'laptop', name: 'Driver Station 筆電', kg: 3, max: 1, need: true },
    { key: 'battery', name: '機器人電池', kg: 6, max: g.cots.battery || 0 },
    { key: 'charger', name: '電池充電器', kg: 3, max: 1 },
    { key: 'toolbox', name: '手工具箱', kg: 18, max: 1 },
    { key: 'drill', name: '電鑽與鑽頭', kg: 5, max: 1 },
    { key: 'tablet', name: 'Scouting 平板', kg: 2, max: 1 },
    { key: 'pit', name: 'Pit 佈置（桌子、燈、隊旗）', kg: 25, max: 1 },
  ];
  // Spare COTS on the shelf.
  for (const [k, q] of Object.entries(g.cots)) if (q > 0 && k !== 'battery') items.push({ key: `cots:${k}`, name: `備品：${COTS[k].name}`, kg: k === 'swerve' ? 3 : k === 'bumper' ? 8 : 1.2, max: q });
  return items;
}
export const DEFAULT_PACK = { robot: 1, laptop: 1, charger: 1, toolbox: 1, drill: 1, tablet: 1, pit: 1 };

// What a packing selection weighs and costs to ship.
export function shipQuote(g, trip, e, sel) {
  const list = packList(g), t = travel(g, e);
  let kg = 0, robot = 0;
  for (const it of list) { const q = Math.min(it.max, sel[it.key] || 0); if (it.key === 'robot') robot = q * it.kg; else kg += q * it.kg; }
  if (trip.mode === 'air') {
    const robotCases = robot ? Math.ceil(robot / 28) : 0, cases = robotCases + Math.ceil(kg / 23);
    const free = 2 * travelers(g, trip);
    const fee = cases * 60 + robotCases * 150 + Math.max(0, cases - free) * 200 + (robot ? robotCases * 120 : 0);
    return { kg: kg + robot, cases, fee, note: `${cases} 箱（機器人 ${robotCases} 箱，超重超大件要加錢）；每人可托運 2 箱，共 ${free} 箱` };
  }
  const fee = trip.mode === 'land' ? Math.round(250 + t.km * 0.9) : Math.round(900 + t.km * 0.12 + (t.land ? 0 : 400));
  return { kg: kg + robot, cases: 1, fee, note: trip.mode === 'land' ? `一個木箱，卡車運 ${t.km} km` : `一個木箱，海運 ${t.km} km${t.land ? '' : '（含報關）'}` };
}
export const packHours = (trip) => (trip.mode === 'air' ? 4 : 1.5);

// Ship (land/sea) or check in (air): the robot leaves the shop.
export function ship(g, trip, e) {
  const q = shipQuote(g, trip, e, trip.pack);
  g.money -= q.fee; g.stats.spent += q.fee;
  trip.shipped = g.t;
  trip.shipFee = q.fee;
  g.robotAway = trip.key;
  log(g, `機器人${trip.mode === 'air' ? '裝箱完成' : `用${MODES[trip.mode].name}寄出`}（${money(q.fee)}）。`);
}

// ---------- The trip ----------
export function newTrip(g, e) {
  const t = travel(g, e);
  return { key: e.key, mode: t.land ? 'land' : 'air', crew: g.crew.length, tickets: 0, hotel: null, site: 'none', siteReply: null, pack: null, shipped: null, stage: 'plan', damage: [] };
}

// Ask a local team for their practice field: they answer by mail a day or two later.
export function askTeam(g, trip, e) {
  trip.site = 'team';
  trip.siteReply = { at: g.t + (1 + Math.random()) * DAY, yes: Math.random() < 0.55 + g.team.tier * 0.08 };
  log(g, `寫信給 ${e.state || e.country} 的當地隊伍借練習場。`);
}
export function checkReplies(g) {
  for (const trip of Object.values(g.trips || {})) {
    const r = trip.siteReply;
    if (!r || r.done || g.t < r.at) continue;
    r.done = true;
    if (r.yes) mail(g, '當地隊伍', '可以來我們的練習場！', '歡迎！比賽前一天整天都可以來我們學校的練習場測試，場地是完整的地毯和場地元件。');
    else { trip.site = 'none'; mail(g, '當地隊伍', '抱歉，這次不方便', '我們那天自己也要測試，場地借不出來，祝你們比賽順利。'); }
  }
}

// On arrival: the trip shakes things loose. Air travel means putting the robot back together.
export function arrive(g, trip) {
  const m = MODES[trip.mode];
  trip.damage = [];
  for (const [sub, s] of Object.entries(g.subs)) {
    if (!s.done || s.skip) continue;
    const h = (g.health[sub] ??= { wear: 0, broken: false });
    if (Math.random() < m.damage * (1.3 - s.q)) {
      if (Math.random() < 0.35) h.broken = true; else h.wear = Math.min(1, h.wear + 0.2);
      trip.damage.push(sub);
    }
  }
  trip.rebuilt = !m.rebuild;
  trip.stage = 'arrived';
}
