import * as THREE from '../three.js';
import { eventByKey, shortName } from '../season.js';
import { rankings, candidates, playerPick, playerRespond, matchSettings, record, lineup, teamName, playoffs } from '../event.js';
import { DAY, SUBS, fmtDate, fmtClock, money } from './data.js';
import { advance, log, mail, save as saveGame, driverLevel, nextOpen } from './state.js';
import { MODES, HOTELS, SITES, tripTimes, travel, travelers, ticketPrice, hotelPrice, packList, DEFAULT_PACK, shipQuote, packHours, ship, arrive } from './trip.js';
import {
  OPEN, CLOSE, matchBuild, startEvent, matchTime, ours, myMatches, nextMine, TimedRunner, BREAK, health, prepRobot, noShowBuild, driverSkill, afterMatch,
  repairPlan, repair, serviceMin, service, initBatteries, chargeBatteries, swapBattery, inspect, observe, scoutView, finishEvent, seasonOver,
} from './compete.js';
import { Venue, TestSite } from './venue3d.js';
import { Houston } from './houston.js';

// Houston's championship and Einstein get the real convention-center layout.
export const VENUES = { champs: Houston, einstein: Houston };
import { LiveMatch } from './matchview.js';

// The competition side of the career, driven from the game loop: deadlines at home, the trip,
// the test site, every event day in the venue, our matches, and coming home again.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const ROLE = { pit: 'Pit 維修', scout: 'Scouting', runner: '推車（排隊上場）', drive: '操駕', rest: '休息' };
const FINISH = { 1: '冠軍', 2: '亞軍', 3: '第 3 名', 4: '第 4 名', 5: '第 5–6 名', 7: '第 7–8 名' };

export class EventFlow {
  // ctx: { g(), panel(html, buttons, wide), closePanel(), toast(t, kind), hud(), setPlace(place, scene), mode(m), startPractice(opts), startAssembly(sub, cb), seasonEnd() }
  constructor(ctx) {
    this.c = ctx;
    this.runner = new TimedRunner((id, res, mine) => this.onResult(id, res, mine));
    this.live = null;
    this.fast = false;
  }
  get g() { return this.c.g(); }
  get place() { return this.c.place(); }
  entry() { return this.g.schedule.find((s) => s.status === 'active') || this.g.schedule.find((s) => s.status === 'pending'); }
  trip(e = this.entry()) { return e && this.g.trips[e.key]; }

  // ---------- Every tick ----------
  tick(min) {
    const g = this.g;
    if (g.where === 'shop') this.homeTick();
    else if (g.where === 'venue' && g.ev) this.venueTick(min);
  }

  homeTick() {
    const g = this.g, en = g.schedule.find((s) => s.status === 'pending');
    if (g.robotBack && g.t >= g.robotBack) { g.robotBack = null; g.robotAway = null; log(g, '機器人運回工作室了。'); }
    if (!en || this.c.busy()) return;
    const e = eventByKey(en.key), trip = g.trips[en.key], T = tripTimes(e);
    if (trip.mode !== 'air' && !trip.shipped) {
      const at = (T.D - MODES[trip.mode].ship) * DAY + 8 * 60;
      if (!trip.warned && g.t >= at - 2 * DAY) { trip.warned = true; mail(g, '物流', `${shortName(e.name)}：機器人 ${fmtDate(at)} 要寄出`, `用${MODES[trip.mode].name}的話，機器人要在 ${fmtDate(at)} 早上前打包好（工作室門口的木箱）。來不及的話只能改成托運。`); }
      if (g.t >= at) {
        if (trip.pack) { ship(g, trip, e); this.c.toast(`機器人用${MODES[trip.mode].name}寄出了`); }
        else { trip.mode = 'air'; mail(g, '物流', '來不及寄出', `機器人沒有在期限前打包好，${shortName(e.name)} 只能改成托運，跟著隊伍一起走。`); }
      }
    }
    if (g.t >= T.depart && trip.stage === 'plan') this.departPrompt(en, e, trip);
  }

  // ---------- Leaving ----------
  departPrompt(en, e, trip) {
    const g = this.g, n = travelers(g, trip), tp = ticketPrice(g, e), t = travel(g, e);
    const missing = [];
    if (!trip.pack) missing.push('還沒打包：會匆忙打包（只帶機器人、筆電和電池）');
    if (trip.tickets < n) missing.push(`${t.bus ? '車票' : '機票'}還缺 ${n - trip.tickets} 張：現在買每張 ${money(tp)}`);
    if (trip.hotel === null) missing.push('還沒訂飯店：會臨時訂標準飯店（比較貴）');
    this.c.panel(`<h2>出發：${esc(shortName(e.name))}</h2><p>${fmtDate(T(e).D * DAY)} 開賽 · ${t.km} km · ${t.bus ? '坐巴士' : '搭飛機'} · 機器人：${MODES[trip.mode].name}</p>
      ${missing.length ? `<ul class="p-log">${missing.map((m) => `<li class="bad">${m}</li>`).join('')}</ul>` : '<p class="ok">都準備好了。</p>'}
      <p class="muted">路程直接跳過。</p>`, [['出發', () => { this.depart(en, e, trip); return false; }]]);
    void en;
  }

  depart(en, e, trip) {
    const g = this.g, T = tripTimes(e), n = travelers(g, trip);
    if (!trip.pack) { trip.pack = { robot: 1, laptop: 1, battery: Math.min(2, g.cots.battery || 0) }; trip.rushed = true; }
    if (!trip.shipped) ship(g, trip, e);
    if (trip.tickets < n) { const c = (n - trip.tickets) * ticketPrice(g, e); g.money -= c; g.stats.spent += c; trip.tickets = n; }
    if (trip.hotel === null) { const c = hotelPrice(g, e, 1, n) * 1.3; g.money -= c; g.stats.spent += c; trip.hotel = 1; }
    trip.people = [...g.crew].sort((a, b) => b.skill - a.skill).slice(0, trip.crew).map((c) => c.id);
    trip.stage = 'travel';
    g.where = 'travel';
    this.c.closePanel(false);
    advance(g, Math.max(g.t, T.arrive));
    arrive(g, trip);
    initBatteries(g, trip.pack.battery || 0);
    g.evRoles = {};
    const people = g.crew.filter((c) => trip.people.includes(c.id));
    people.forEach((c, i) => { g.evRoles[c.id] = c.role === 'drive' ? 'drive' : i % 3 === 2 ? 'scout' : 'pit'; });
    log(g, `抵達 ${e.state || e.country}，住進${HOTELS[trip.hotel].name}。`);
    // A night at the hotel, then the test day.
    this.night(trip);
    advance(g, T.test);
    if (trip.site !== 'none' && !(trip.site === 'team' && !trip.siteReply?.yes)) this.toTestSite(trip);
    else {
      this.c.panel(`<h2>${fmtDate(g.t)} 測試日</h2><p>沒有借到測試場地，整天在飯店房間整理機器${MODES[trip.mode].rebuild ? '（托運拆開的部分要到賽場 pit 再組回去）' : ''}。</p><p class="muted">明天一早 load-in。</p>`, [['前往賽場', () => { this.loadIn(); return false; }]]);
    }
    saveGame(g);
  }

  night(trip) {
    const rest = HOTELS[trip.hotel ?? 1].rest;
    for (const c of this.g.crew) c.stamina = Math.min(1, c.stamina + 0.55 * rest);
  }

  // ---------- Test site ----------
  toTestSite(trip) {
    const g = this.g;
    g.where = 'testsite';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1c20);
    this.c.setPlace(new TestSite(scene, g, trip.site), scene);
    this.c.closePanel(false);
    this.c.panel(`<h2>${SITES[trip.site].name}</h2><p>${fmtDate(g.t)} · 測試日。先檢查機器${MODES[trip.mode].rebuild ? '並重新組裝' : ''}，再開到場上測試。</p>
      ${trip.damage.length ? '<p class="muted">運送路上有東西鬆了也說不定，試車就知道。</p>' : ''}<p class="muted">準備好就從門口「前往賽場 load-in」。</p>`, [['開始', () => {}]]);
  }

  rebuild(cb) {
    const g = this.g, trip = this.trip();
    this.c.startAssembly('frame', (q) => {
      trip.rebuilt = true;
      // Putting it back together badly costs quality across the board.
      for (const s of Object.values(g.subs)) if (s.done && !s.skip) s.q = +(s.q * (0.94 + 0.06 * q)).toFixed(3);
      log(g, `機器人重新組裝完成（${pct(q)}）。`);
      cb?.();
    });
  }

  testDrive() {
    const g = this.g, trip = this.trip();
    if (!trip.rebuilt) { this.c.toast('先把機器人組回去', 'bad'); return; }
    if (!(g.batt?.length)) { this.c.toast('沒有帶電池', 'bad'); return; }
    trip.known = true;
    prepRobot(g);
    this.c.startPractice({ quality: SITES[trip.site].q, build: matchBuild(g), onEnd: () => {
      const broken = Object.keys(BREAK).filter((s) => health(g, s).broken && g.subs[s]?.done);
      this.c.panel(`<h2>測試結果</h2>${broken.length ? `<p class="bad">發現問題：${broken.map((s) => BREAK[s].name).join('、')}。到推車修理。</p>` : '<p class="ok">機器人狀況良好。</p>'}`);
    } });
  }

  loadIn() {
    const g = this.g, en = this.entry();
    this.c.closePanel(false);
    const D = tripTimes(eventByKey(en.key)).D;
    if (g.t < D * DAY + OPEN) { this.night(this.trip()); advance(g, D * DAY + OPEN); }
    this.toVenue(en);
  }

  toVenue(en) {
    const g = this.g;
    startEvent(g, en);
    g.where = 'venue';
    this.runner.reset();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c1f26);
    this.c.setPlace(new (VENUES[g.ev.venue] || Venue)(scene, g, g.ev), scene);
    const t = this.trip();
    this.c.panel(`<h2>${esc(g.ev.title)}</h2><p>第 1 天：load-in、佈置 pit、安檢。資格賽明天 ${fmtClock(9 * 60)} 開始。</p>
      <ul class="p-log"><li>先到 Pit Admin 申請安檢，檢查員會到 pit 來。沒過安檢不能上資格賽。</li>
      <li>輪到我們時要把機器人從 pit 推到排隊區，再推到入場口；派了「推車」的隊友就會幫你推。</li>
      <li>走到觀眾席就能看別隊比賽的實況。Tab 打開平板：賽程、排名、scouting、隊員分工。</li>
      ${!t.rebuilt ? '<li class="bad">托運拆開的機器人還沒組回去：到 pit 的推車上組裝。</li>' : ''}</ul>`, [['開始', () => {}]], true);
    saveGame(g);
  }

  // ---------- Event days ----------
  dayOf() { return Math.floor(this.g.t / DAY) - this.g.ev.D + 1; }

  venueTick(min) {
    const g = this.g, ev = g.ev, trip = this.trip();
    chargeBatteries(g, min, trip?.pack?.charger);
    // The inspector walks over, then inspects.
    if (g.insp?.state === 'coming' && g.t >= g.insp.at) {
      if (g.robotPos !== 'pit') { g.insp.at = g.t + 20; this.c.toast('檢查員到了 pit，但機器人不在。他晚點再來。', 'bad'); }
      else { g.insp.state = 'here'; this.inspection(); }
    }
    // Pit crew: batteries and repairs while the robot is in the pit.
    const crew = g.crew.filter((c) => g.evRoles?.[c.id] === 'pit');
    if (crew.length && g.robotPos === 'pit') {
      const bat = g.batt?.[g.battIn];
      if (bat && bat.c < 0.6 && swapBattery(g)) log(g, '隊友換上充好的電池。');
      if (g.pitWork && g.t >= g.pitWork.until) { repair(g, g.pitWork.sub); g.pitWork = null; }
      if (!g.pitWork && (this.g.trips[ev.key]?.rebuilt ?? true)) {
        const sub = Object.keys(BREAK).find((s) => health(g, s).broken && g.subs[s]?.done && (trip.known || g.mine.firstPlayed));
        if (sub) g.pitWork = { sub, until: g.t + repairPlan(g, sub).min * 1.3 / Math.min(2, crew.length) };
      }
    }
    // Other matches.
    this.runner.pump(g, this.live?.id, (id) => !!g.mine[id]?.bg);
    this.ourMatch();
    // In the stands: show the match that's on now.
    if (!this.live && this.place.inStands?.() && !this.c.panelOpen()) { const id = this.watchable(); if (id) this.startLive(id, false); }
    if (ev.sel && !ev.selShown && ev.quals.length && g.t >= ev.selT && !this.selecting && !this.c.panelOpen()) this.selection();
    if (ev.phase === 'done' && !this.closing && !this.live) this.closing = setTimeout(() => this.closingCeremony(), 300);
    // End of the day at the hotel.
    const d = this.dayOf();
    if (!this.ending && !this.live && !this.c.panelOpen() && ev.phase !== 'done' && Math.floor(g.t / DAY) * DAY + CLOSE <= g.t && !(d >= 3 && ev.phase === 'playoffs')) this.dayEnd();
    if (this.fast && ev.phase === 'done') this.fast = false;
  }

  ourMatch() {
    const g = this.g;
    // A live match of ours that got cut off (reload, left the stands): let the workers finish it.
    for (const [id, st] of Object.entries(g.mine)) if (st?.started && !st.bg && !st.done && this.live?.id !== id) st.bg = true;
    const m = nextMine(g);
    if (!m) return;
    const st = (g.mine[m.id] ??= {});
    const runner = g.crew.some((c) => g.evRoles?.[c.id] === 'runner');
    if (!st.called && g.t >= m.t - 20) {
      st.called = true;
      this.c.toast(`${m.id} 叫排隊了（${fmtClock(m.t)} 上場）`);
      if (runner && ['pit', 'gate'].includes(g.robotPos) && !g.pitWork && !this.live) { g.robotPos = 'queue'; this.c.toast('隊友把機器人推去排隊了'); }
    }
    if (st.started || st.bg) return;
    if (runner && g.robotPos === 'queue' && g.t >= m.t - 6) { g.robotPos = 'gate'; g.matchColor = this.colorOf(m.id); st.driver ??= 'crew'; }
    if (runner && g.robotPos === 'pit' && g.t >= m.t - 6 && !g.pitWork && !this.live) { g.robotPos = 'gate'; g.matchColor = this.colorOf(m.id); st.driver ??= 'crew'; }
    if (g.t >= m.t - 1 && g.robotPos === 'gate' && st.driver && g.inspected) {
      st.started = true;
      prepRobot(g);
      if (st.driver === 'me') this.startLive(m.id, true);
      else if (this.place.inStands?.()) this.startLive(m.id, false);
      else { st.bg = true; this.c.toast(`${m.id} 由隊友上場`); }
      return;
    }
    if (g.t >= m.t + 2) {
      st.started = true; st.bg = true; st.noshow = true;
      noShowBuild(g);
      this.c.toast(`${m.id} 機器人沒有上場（${g.inspected ? '沒推到入場口' : '還沒通過安檢'}）`, 'bad');
      log(g, `${m.id} 缺賽。`);
    }
  }
  colorOf(id) { const lu = lineup(this.g.ev, id); return lu.red.includes(this.g.team.number) ? 'red' : 'blue'; }

  // A match result came back (from a worker or the live field).
  onResult(id, res, mine) {
    const g = this.g, trip = this.trip();
    const scouts = g.crew.filter((c) => g.evRoles?.[c.id] === 'scout').length;
    observe(g, res, Math.min(1, scouts * 0.3 * (trip.pack?.tablet ? 1 : 0.5)));
    if (mine) {
      const st = (g.mine[id] ??= {});
      st.done = true;
      g.mine.firstPlayed = true;
      if (!st.noshow) afterMatch(g, id);
      const color = this.colorOf(id), a = res[color].total, b = res[color === 'red' ? 'blue' : 'red'].total;
      this.c.toast(`${id}：${a} : ${b} ${a > b ? '贏了！' : a < b ? '輸了' : '平手'}${st.noshow ? '（我們缺賽）' : ''}`, a >= b ? '' : 'bad');
      if (g.robotPos === 'gate' || g.robotPos === 'field') g.robotPos = g.crew.some((c) => g.evRoles?.[c.id] === 'runner') ? 'pit' : 'gate';
    }
  }

  // ---------- Live matches ----------
  watchable() {
    const g = this.g, ev = g.ev;
    for (const id of [...ev.quals.map((m) => m.id), ...Object.keys(ev.ptimes)]) {
      const t = matchTime(ev, id);
      if (t === undefined || g.t < t || g.t > t + 3 || ours(ev, id)) continue;
      const q = id[0] === 'Q' ? ev.quals.find((m) => m.id === id) : playoffs(ev).find((m) => m.id === id);
      if (!q || q.result || this.runner.busy.has(id)) continue;
      return id;
    }
    return null;
  }
  startLive(id, human) {
    const g = this.g, ev = g.ev;
    delete this.runner.pending[id];
    const { settings, playerBot } = matchSettings(ev, id, {});
    if (ours(ev, id)) settings.lineup.ally.forEach(() => {});
    this.live = new LiveMatch(this.place.scene, this.place.field, settings, { human, playerBot: ours(ev, id) ? driverSkill(g) : playerBot, id });
    if (ours(ev, id)) g.robotPos = 'field';
    this.c.mode(human ? 'live' : 'watch');
  }
  updateLive(dt, camera) {
    const L = this.live;
    if (!L) return;
    const done = L.update(dt, camera);
    if (!L.human && !this.place.inStands() && !ours(this.g.ev, L.id)) { this.stopLive(); return; }
    if (done) this.finishLive();
  }
  stopLive() { this.live.dispose(); this.live = null; this.c.mode('venue'); }  // ours falls back to the workers (see ourMatch)
  finishLive() {
    const g = this.g, L = this.live, res = L.summary(), id = L.id, mine = ours(g.ev, id);
    L.dispose();
    this.live = null;
    this.c.mode('venue');
    if (record(g.ev, id, res, L.human)) {
      observe(g, res, 1);
      this.onResult(id, res, mine);
    }
    if (mine) {
      g.robotPos = g.crew.some((c) => g.evRoles?.[c.id] === 'runner') ? 'pit' : 'gate';
      if (L.human) { const p = this.place.player, gt = this.place.gates[g.matchColor || 'blue']; p.x = gt.x; p.z = gt.z + 2.2; p.yaw = 0; p.pitch = -0.2; }
    }
  }
  liveHud() {
    const L = this.live;
    if (!L) return '';
    const [r, b] = L.score, c = L.clock, me = L.human ? L.me : null;
    return `<div class="lv-score"><span class="r">${r}</span><span class="mid"><b>${c.t}</b><small>${esc(c.phase)} · ${L.id}</small></span><span class="b">${b}</span></div>
      ${me ? `<div class="lv-me">FUEL <b>${me.fuel}</b> / ${me.cap} · 進球 ${me.scored}${me.climb ? ` · L${me.climb}` : ''}<br><small>WASD 移動 · J／L 旋轉 · Space／左鍵 射擊 · C 攀爬</small></div>` : '<div class="lv-me"><small>觀眾席：實況轉播中</small></div>'}`;
  }

  // ---------- Interactions ----------
  // Returns true if handled.
  interact(aim) {
    const g = this.g, k = aim.kind;
    if (k === 'crate') { this.packing(); return true; }
    if (k === 'testdrive') { this.testDrive(); return true; }
    if (k === 'loadin') { this.c.panel('<h2>前往賽場？</h2><p>今天的測試就到這裡，晚上 load-in，明天一早開始比賽。</p>', [['出發', () => { this.loadIn(); return false; }], ['再待一下', () => {}]]); return true; }
    if (k === 'robot') { this.robotPanel(); return true; }
    if (k === 'battery') { this.batteryPanel(); return true; }
    if (k === 'pitcrew') { this.tablet('crew'); return true; }
    if (k === 'admin') { this.adminPanel(); return true; }
    if (k === 'queue') { this.queuePanel(); return true; }
    if (k === 'gate') { this.gatePanel(aim.key); return true; }
    if (k === 'leave') { this.leavePanel(); return true; }
    void g;
    return false;
  }

  robotPanel() {
    const g = this.g, trip = this.trip(), atVenue = g.where === 'venue', p = this.place.player;
    if (g.robotPos === 'carried') {
      if (atVenue && this.place.near(p, this.place.cartHome, 2.4)) { g.robotPos = 'pit'; this.c.toast('機器人放回 pit'); return; }
      this.c.toast('推到 pit、排隊區或入場口再放下', 'bad'); return;
    }
    if (atVenue && g.robotPos !== 'pit') { g.robotPos = 'carried'; this.c.toast('推著機器人（慢慢走）'); this.c.lock(); return; }
    const broken = Object.keys(BREAK).filter((s) => health(g, s).broken && g.subs[s]?.done && (trip.known || g.mine?.firstPlayed));
    const worn = Object.keys(BREAK).filter((s) => g.subs[s]?.done && health(g, s).wear > 0.25);
    const bat = g.batt?.[g.battIn];
    const actions = [];
    if (!trip.rebuilt) actions.push(['重新組裝（托運拆開的）', () => { this.rebuild(); }]);
    for (const s of broken) { const r = repairPlan(g, s); actions.push([`修理${BREAK[s].name}（${r.min} 分鐘${r.spare ? '，用備品' : B_NOSPARE(s)}）`, () => { this.c.passMinutes(r.min, `修理${SUBS[s].name}`, () => repair(g, s)); }]); }
    for (const s of worn) actions.push([`保養${SUBS[s].name}（${serviceMin(g)} 分鐘）`, () => { this.c.passMinutes(serviceMin(g), `保養${SUBS[s].name}`, () => service(g, s)); }]);
    if (atVenue) actions.push(['推著走', () => { g.robotPos = 'carried'; this.c.lock(); }]);
    this.c.panel(`<h2>${g.team.number} 的機器人</h2>
      <table class="p-table">${Object.keys(BREAK).filter((s) => g.subs[s]?.done && !g.subs[s].skip).map((s) => { const h = health(g, s); const known = trip.known || g.mine?.firstPlayed; return `<tr><td>${SUBS[s].name}</td><td>品質 ${pct(g.subs[s].q)}</td><td>磨損 ${pct(h.wear)}</td><td>${h.broken && known ? `<b class="bad">${BREAK[s].name}</b>` : known ? 'OK' : '<span class="muted">未測試</span>'}</td></tr>`; }).join('')}</table>
      <p>電池：${bat ? pct(bat.c) : '<span class="bad">沒有電池</span>'}${g.pitWork ? ` · 隊友正在修${SUBS[g.pitWork.sub].name}（${fmtClock(g.pitWork.until)} 好）` : ''}</p>`,
    [...actions.map(([l, f]) => [l, () => { f(); }]), ['關閉', () => {}]], true);
  }

  batteryPanel() {
    const g = this.g, pack = this.trip()?.pack || {};
    this.c.panel(`<h2>電池</h2>${g.batt?.length ? `<table class="p-table">${g.batt.map((b, i) => `<tr><td>電池 ${i + 1}${i === g.battIn ? '（在機器人上）' : ''}</td><td>${pct(b.c)}</td></tr>`).join('')}</table>` : '<p class="bad">沒有帶電池。</p>'}
      <p class="muted">${pack.charger ? '充電器一次充一顆，滿電大約 70 分鐘。' : '沒有帶充電器！電池用完就沒了。'}每場比賽大約用掉一半的電。</p>`,
    [['換上最滿的電池', () => { if (swapBattery(this.g)) this.c.toast('換好電池'); }], ['關閉', () => {}]]);
  }

  adminPanel() {
    const g = this.g, ev = g.ev;
    const mine = myMatches(ev);
    const inspBtn = g.inspected ? [] : [[g.insp?.state === 'coming' ? '檢查員已經在路上' : '申請安檢', () => {
      if (g.insp?.state === 'coming') return;
      g.insp = { ...(g.insp || {}), state: 'coming', at: g.t + 10 + Math.random() * 25 };
      this.c.toast('已申請安檢，檢查員會到 pit');
    }]];
    this.c.panel(`<h2>Pit Admin</h2><p>${esc(ev.title)} · 第 ${this.dayOf()} 天 · 安檢 ${g.inspected ? '<b class="ok">已通過</b>' : '<b class="bad">未通過</b>'}</p>
      <h3>我們的場次</h3><table class="p-table">${mine.map((m) => `<tr><td>${m.id}</td><td>${fmtClock(m.t)}</td><td>${m.result ? this.scoreText(m.id) : g.mine[m.id]?.noshow ? '缺賽' : ''}</td></tr>`).join('') || '<tr><td>還沒排</td></tr>'}</table>
      <p class="muted">資格賽 ${ev.quals.length} 場，選聯盟 ${fmtClock(ev.selT)}。</p>`, [...inspBtn, ['關閉', () => {}]], true);
  }
  scoreText(id) {
    const g = this.g, ev = g.ev, q = id[0] === 'Q' ? ev.quals.find((m) => m.id === id) : playoffs(ev).find((m) => m.id === id);
    if (!q?.result) return '';
    const c = this.colorOf(id), a = q.result[c].total, b = q.result[c === 'red' ? 'blue' : 'red'].total;
    return `<span class="${a > b ? 'ok' : a < b ? 'bad' : ''}">${a}:${b}</span>`;
  }

  inspection() {
    const g = this.g, items = inspect(g);
    const pass = items.every((i) => i.ok);
    g.insp.state = 'done';
    if (pass) { g.inspected = true; log(g, '通過安檢！'); }
    const fails = items.filter((i) => !i.ok && i.fix);
    this.c.panel(`<h2>安檢${pass ? '通過' : '沒過'}</h2><table class="p-table">${items.map((i) => `<tr><td>${i.ok ? '✓' : '✗'}</td><td class="${i.ok ? '' : 'bad'}">${esc(i.name)}</td></tr>`).join('')}</table>
      ${pass ? '<p class="ok">貼上安檢貼紙，可以上資格賽了。</p>' : `<p>修好之後再到 Pit Admin 申請一次。</p>${items.some((i) => !i.ok && !i.fix) ? '<p class="bad">有些問題是設計本身或機器人不能動，在賽場上沒辦法修。</p>' : ''}`}`,
    [...fails.map((i) => [`${i.fixName}（${i.fix} 分鐘）`, () => {
      this.c.passMinutes(i.fix, i.fixName, () => {
        g.insp = { ...(g.insp || {}), state: null, fixed: { ...(g.insp?.fixed || {}), [i.key]: true } };
        if (i.key === 'weight') { g.insp.cut = (g.insp.cut || 0) + 3; g.design.mods = { ...(g.design.mods || {}) }; }
      });
    }]), ['關閉', () => {}]], true);
  }

  queuePanel() {
    const g = this.g, m = nextMine(g);
    if (g.robotPos === 'carried' && m) {
      if (g.t < m.t - 25) { this.c.toast(`${m.id} 還沒叫排隊（${fmtClock(m.t - 20)} 開始）`, 'bad'); return; }
      g.robotPos = 'queue';
      this.c.toast(`${m.id} 排隊中，${fmtClock(m.t - 6)} 左右會叫你推到入場口`);
      return;
    }
    this.c.panel(`<h2>排隊區</h2><p>${m ? `我們的下一場：${m.id}（${fmtClock(m.t)}），${fmtClock(m.t - 20)} 開始排隊。` : '我們沒有比賽了。'}</p><p class="muted">把機器人推到這裡排隊，叫到時再推到入場口。</p>`);
  }

  gatePanel(color) {
    const g = this.g, m = nextMine(g);
    if (!m) { this.c.toast('我們現在沒有比賽', 'bad'); return; }
    const mine = this.colorOf(m.id);
    if (!['carried', 'queue'].includes(g.robotPos)) { this.c.toast('先把機器人推過來', 'bad'); return; }
    if (g.robotPos === 'queue' && !this.place.near(this.place.player, this.place.queueSpot, 3)) { this.c.toast('機器人還在排隊區，去推過來', 'bad'); return; }
    if (color !== mine) { this.c.toast(`我們這場是${mine === 'red' ? '紅' : '藍'}聯盟，走另一個入場口`, 'bad'); return; }
    if (g.t < m.t - 8) { this.c.toast(`還沒輪到 ${m.id}（${fmtClock(m.t)}）`, 'bad'); return; }
    if (!g.inspected) { this.c.toast('還沒通過安檢，不能上場', 'bad'); return; }
    g.robotPos = 'gate';
    g.matchColor = mine;
    const st = (g.mine[m.id] ??= {});
    this.c.panel(`<h2>${m.id} · ${mine === 'red' ? '紅' : '藍'}聯盟</h2><p>${lineup(g.ev, m.id)[mine].map((n) => esc(teamName(g.ev, n))).join('、')} vs ${lineup(g.ev, m.id)[mine === 'red' ? 'blue' : 'red'].map((n) => esc(teamName(g.ev, n))).join('、')}</p><p>誰上場操駕？</p>`,
      [['我自己開', () => { st.driver = 'me'; }], [`交給隊友（${driverLevel(g.practice)}）`, () => { st.driver = 'crew'; }]]);
  }

  leavePanel() {
    const g = this.g, ev = g.ev, d = this.dayOf();
    const out = ev.phase === 'playoffs' && !playoffs(ev).some((m) => !m.result && !m.skip && (m.a === null || m.b === null || ours(ev, m.id)));
    if (d >= 3 && (ev.phase === 'playoffs' || ev.phase === 'selection')) {
      this.c.panel('<h2>還沒結束</h2><p>淘汰賽還在進行。要快轉到閉幕嗎？</p>', [['快轉到閉幕', () => { this.fast = true; }], ['留下來', () => {}]]);
      void out;
      return;
    }
    this.c.panel('<h2>今天先回飯店？</h2><p>會直接跳到明天早上。今天還沒打的場次照常進行。</p>', [['回飯店', () => { this.dayEnd(true); return false; }], ['留下來', () => {}]]);
  }

  dayEnd(early = false) {
    const g = this.g, ev = g.ev, d = this.dayOf();
    if (this.live) return;
    if (early) {
      // Let today's matches play out before morning.
      const end = Math.floor(g.t / DAY) * DAY + CLOSE;
      this.ending = true;
      while (g.t < end) this.c.run(Math.min(5, end - g.t));
      this.ending = false;
    }
    const ranks = ev.quals.some((m) => m.result) ? rankings(ev) : [];
    const rank = ranks.findIndex((r) => r.number === g.team.number) + 1;
    const today = myMatches(ev).filter((m) => Math.floor(m.t / DAY) === Math.floor(g.t / DAY) && m.result);
    if (g.robotPos === 'carried' || g.robotPos === 'queue' || g.robotPos === 'gate') g.robotPos = 'pit';
    this.night(this.trip());
    advance(g, (Math.floor(g.t / DAY) + 1) * DAY + OPEN);
    const p = this.place.player, f = this.place.boothFront;
    p.x = f.x; p.z = f.z; p.yaw = f.yaw;
    saveGame(g);
    this.c.panel(`<h2>第 ${d} 天結束</h2>${today.length ? `<p>今天的場次：${today.map((m) => `${m.id} ${this.scoreText(m.id)}`).join('、')}</p>` : ''}${rank ? `<p>目前排名第 <b>${rank}</b> / ${ev.size}</p>` : ''}<p class="muted">回飯店休息。${fmtDate(g.t)} ${fmtClock(g.t)} 回到賽場。</p>`, [['開始第 ' + (d + 1) + ' 天', () => {}]]);
  }

  // ---------- Alliance selection ----------
  selection() {
    const g = this.g, ev = g.ev;
    this.selecting = true;
    const s = ev.sel;
    if (!s.pending) {
      const k = s.alliances.findIndex((a) => a.includes(g.team.number));
      ev.selShown = true;
      this.c.panel(`<h2>選聯盟結果</h2>${this.allianceTable()}<p>${k >= 0 ? `我們在第 ${k + 1} 聯盟！淘汰賽 ${fmtClock(ev.selT + 50)} 開始。` : '這次沒有被選進聯盟。可以留下來看淘汰賽，或從出口快轉到閉幕。'}</p>`, [['好', () => { this.selecting = false; }]], true);
      return;
    }
    if (s.pending.type === 'invite') {
      const cap = s.alliances[s.pending.k][0];
      this.c.panel(`<h2>選聯盟</h2><p>第 ${s.pending.k + 1} 聯盟隊長 <b>${esc(teamName(ev, cap))}</b> 邀請我們加入！</p>${this.allianceTable()}`,
        [['接受', () => { playerRespond(ev, true); this.selecting = false; }], ['婉拒', () => { playerRespond(ev, false); this.selecting = false; }]], true);
      return;
    }
    const list = candidates(ev).slice(0, 24);
    this.c.panel(`<h2>選聯盟：我們是第 ${s.pending.k + 1} 聯盟隊長</h2><p class="muted">Scouting 資料越多，估計越準。沒看過的隊伍只有排名。</p>
      <table class="p-table"><tr><th>排名</th><th>隊伍</th><th>平均分</th><th>Scouting：進球</th><th>攀爬</th><th></th></tr>
      ${list.map((r) => { const sv = scoutView(g, r.number), rank = rankings(ev).findIndex((x) => x.number === r.number) + 1; return `<tr><td>${rank}</td><td>${esc(teamName(ev, r.number))}</td><td>${r.avgPts.toFixed(0)}</td><td>${sv ? `${sv.scored.toFixed(1)}（${sv.n} 場）` : '<span class="muted">—</span>'}</td><td>${sv ? `L${sv.climb.toFixed(1)}` : ''}</td><td><button data-pa="pick" data-n="${r.number}">選這隊</button></td></tr>`; }).join('')}</table>`, [], true);
    this.c.setAction((a) => { if (a.dataset.pa === 'pick') { playerPick(ev, +a.dataset.n); this.c.closePanel(false); this.selecting = false; } });
  }
  allianceTable() {
    const ev = this.g.ev;
    return `<table class="p-table">${ev.sel.alliances.map((a, i) => `<tr class="${a.includes(this.g.team.number) ? 'me' : ''}"><td>${i + 1}</td><td>${a.map((n) => esc(teamName(ev, n))).join('、') || '…'}</td></tr>`).join('')}</table>`;
  }

  // ---------- Leaving the event ----------
  closingCeremony() {
    const g = this.g;
    const res = this.closingRes ??= finishEvent(g);
    const next = g.schedule.find((s) => s.status === 'pending');
    const einstein = next?.kind === 'einstein';
    this.c.panel(`<h2>${esc(res.name)} 結束</h2>
      <p>${res.rank ? `資格賽第 ${res.rank} / ${res.N}（${res.record}）` : ''}${res.alliance !== null ? ` · 第 ${res.alliance + 1} 聯盟${['隊長', '第一指名', '第二指名'][res.role] || ''}` : ''}${res.finish ? ` · ${FINISH[res.finish]}` : ''}</p>
      <ul class="p-log">${res.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`,
    [[einstein ? '明天：Einstein' : '回家', () => { this.closing = null; this.closingRes = null; if (einstein) this.toEinstein(next); else this.goHome(); return false; }]], true);
  }

  toEinstein(en) {
    const g = this.g;
    advance(g, (Math.floor(g.t / DAY) + 1) * DAY + OPEN);
    g.trips[en.key] = g.trips[g.ev.key];
    this.toVenue(en);
  }

  goHome() {
    const g = this.g, last = g.history[g.history.length - 1], trip = g.trips[last.key];
    const e = eventByKey(last.key), T = tripTimes(e), m = MODES[trip.mode];
    this.c.closePanel(false);
    g.where = 'travel';
    advance(g, Math.max(g.t, T.home));
    // Used spares are gone; the rest comes back.
    for (const [k, q] of Object.entries(trip.pack || {})) if (k.startsWith('cots:')) { const item = k.slice(5), used = (trip.packed0?.[k] ?? q) - q; if (used > 0) g.cots[item] = Math.max(0, g.cots[item] - used); }
    for (const h of Object.values(g.health)) { h.broken = false; h.wear *= 0.5; }
    trip.stage = 'done';
    g.ev = null; g.batt = null; g.inspected = false;
    if (m.back) { g.robotBack = g.t + m.back * DAY; g.robotAway = 'return'; } else g.robotAway = null;
    g.where = 'shop';
    log(g, `回到家了${m.back ? `，機器人 ${fmtDate(g.robotBack)} 才會運回來` : ''}。`);
    advance(g, nextOpen(g));
    this.c.toShop();
    if (seasonOver(g)) { this.c.seasonEnd(); return; }
    saveGame(g);
  }

  // ---------- Packing (the crate by the shop door) ----------
  packing() {
    const g = this.g, en = g.schedule.find((s) => s.status === 'pending');
    if (!en) { this.c.panel('<h2>打包區</h2><p>沒有要去的比賽。</p>'); return; }
    const e = eventByKey(en.key), trip = g.trips[en.key];
    if (trip.shipped) { this.c.panel(`<h2>打包區</h2><p>機器人已經${trip.mode === 'air' ? '裝箱' : '寄出'}了。</p>`); return; }
    if (g.robotAway && g.robotAway !== 'packed') { this.c.panel('<h2>打包區</h2><p>機器人還沒運回來。</p>'); return; }
    const sel = { ...(trip.pack || DEFAULT_PACK), battery: trip.pack?.battery ?? Math.min(3, g.cots.battery || 0) };
    const draw = () => {
      const list = packList(g), q = shipQuote(g, trip, e, sel), T = tripTimes(e);
      const shipAt = trip.mode === 'air' ? T.depart : (T.D - MODES[trip.mode].ship) * DAY + 8 * 60;
      this.c.panel(`<h2>打包：${esc(shortName(e.name))}</h2><p>${MODES[trip.mode].name} · ${trip.mode === 'air' ? `跟著隊伍 ${fmtDate(T.depart)} 出發` : `最晚 ${fmtDate(shipAt)} 早上寄出`}</p>
        <table class="p-table"><tr><th>東西</th><th>重量</th><th>數量</th></tr>${list.map((it) => `<tr><td>${esc(it.name)}${it.need ? ' <small class="bad">必帶</small>' : ''}</td><td>${it.kg} kg</td><td>${it.max > 1 ? `<input type="number" min="0" max="${it.max}" value="${Math.min(it.max, sel[it.key] || 0)}" data-pk="${it.key}" style="width:64px"> / ${it.max}` : `<input type="checkbox" data-pk="${it.key}"${sel[it.key] ? ' checked' : ''}${it.max ? '' : ' disabled'}>`}</td></tr>`).join('')}</table>
        <p>總重 ${Math.round(q.kg)} kg · ${q.note} · 運費 <b>${money(q.fee)}</b>（出貨時付）</p>
        <p class="muted">打包要 ${packHours(trip)} 小時${trip.mode === 'air' ? '（要把機器人拆開裝箱）' : ''}。打包後機器人就不能再改或練習了，可以拆開重來。沒帶的東西到賽場就沒有。</p>`,
      [[trip.pack ? '重新打包' : '打包', () => {
        if (!sel.robot) { this.c.toast('一定要帶機器人', 'bad'); return false; }
        this.c.passMinutes(packHours(trip) * 60, '打包', () => { trip.pack = { ...sel }; trip.packed0 = { ...sel }; g.robotAway = 'packed'; log(g, `${shortName(e.name)} 的行李打包好了。`); });
      }], ...(trip.pack && trip.mode !== 'air' ? [['現在寄出', () => { ship(g, trip, e); this.c.toast('寄出了'); }]] : []), ...(trip.pack ? [['拆開（取消打包）', () => { trip.pack = null; g.robotAway = null; }]] : []), ['關閉', () => {}]], true);
      this.c.setChange((ev) => { const t = ev.target; if (!t.dataset.pk) return; sel[t.dataset.pk] = t.type === 'checkbox' ? (t.checked ? 1 : 0) : Math.max(0, +t.value || 0); draw(); });
    };
    draw();
  }

  // ---------- The tablet (Tab at events) ----------
  tablet(tab = 'sched') {
    const g = this.g, ev = g.ev;
    if (!ev) return;
    const trip = this.trip(), people = g.crew.filter((c) => trip.people?.includes(c.id));
    const tabs = [['sched', '賽程'], ['rank', '排名'], ['crew', '隊員分工']];
    let body = '';
    if (tab === 'sched') {
      const list = [...ev.quals.map((m) => m.id), ...Object.keys(ev.ptimes)].map((id) => ({ id, t: matchTime(ev, id) })).filter((m) => m.t !== undefined && Math.abs(m.t - g.t) < 240).sort((a, b) => a.t - b.t).slice(0, 30);
      body = `<table class="p-table">${list.map((m) => { const lu = lineup(ev, m.id), mine = ours(ev, m.id); return `<tr class="${mine ? 'me' : ''}"><td>${m.id}</td><td>${fmtClock(m.t)}</td><td class="r">${lu.red?.join(' ') || ''}</td><td class="b">${lu.blue?.join(' ') || ''}</td><td>${this.scoreTextAny(m.id)}</td></tr>`; }).join('')}</table>`;
    } else if (tab === 'rank') {
      body = `<table class="p-table"><tr><th>#</th><th>隊伍</th><th>RP</th><th>勝-敗-和</th><th>Scouting 進球</th><th>攀爬</th></tr>${rankings(ev).slice(0, 40).map((r, i) => { const sv = scoutView(g, r.number); return `<tr class="${r.number === g.team.number ? 'me' : ''}"><td>${i + 1}</td><td>${esc(teamName(ev, r.number))}</td><td>${r.avgRp.toFixed(2)}</td><td>${r.w}-${r.l}-${r.t}</td><td>${sv ? `${sv.scored.toFixed(1)}（${sv.n}）` : '—'}</td><td>${sv ? `L${sv.climb.toFixed(1)}` : ''}</td></tr>`; }).join('')}</table>`;
    } else {
      body = `<p class="muted">Pit 維修：自動換電池、修東西。Scouting：記錄別隊的比賽。推車：幫你把機器人推去排隊和上場。操駕：交給隊友開的時候由他上場。</p>
        <table class="p-table">${people.map((c) => `<tr><td>${esc(c.name)}</td><td><small>★${c.skill.toFixed(1)}</small></td><td><select data-role="${c.id}">${Object.entries(ROLE).map(([k, n]) => `<option value="${k}"${g.evRoles[c.id] === k ? ' selected' : ''}>${n}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td>沒有隊員同行</td></tr>'}</table>`;
    }
    this.c.panel(`<div class="tb-tabs">${tabs.map(([k, n]) => `<button data-pa="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div><h2>${esc(ev.title)}</h2>${body}`, [['關閉 (Tab)', () => {}]], true);
    this.c.setAction((a) => { if (a.dataset.pa === 'tab') this.tablet(a.dataset.tab); });
    this.c.setChange((e) => { if (e.target.dataset.role) g.evRoles[e.target.dataset.role] = e.target.value; });
  }
  scoreTextAny(id) {
    const ev = this.g.ev, q = id[0] === 'Q' ? ev.quals.find((m) => m.id === id) : playoffs(ev).find((m) => m.id === id);
    return q?.result ? `${q.result.red.total}:${q.result.blue.total}` : '';
  }

  // HUD line at events.
  status() {
    const g = this.g, ev = g.ev;
    if (!ev) return '';
    const m = nextMine(g), bat = g.batt?.[g.battIn];
    const pos = { pit: '在 pit', carried: '推著走', queue: '排隊中', gate: '在入場口', field: '在場上' }[g.robotPos] || '';
    return `${ev.title} · 第 ${this.dayOf()} 天 · ${m ? `下一場 ${m.id} ${fmtClock(m.t)}` : '沒有場次'} · 機器人${pos} · 電池 ${bat ? pct(bat.c) : '—'} · 安檢${g.inspected ? '✓' : '✗'}`;
  }
}
const B_NOSPARE = (s) => (BREAK[s].spare ? '，沒帶備品' : '');
const T = (e) => tripTimes(e);
