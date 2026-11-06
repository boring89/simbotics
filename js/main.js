import * as THREE from './three.js';
import { HL, ROBOT_PRESETS, BOT_SKILL, COLORS, side, other } from './config.js';
import { buildField, inZone } from './field.js';
import { TACTICS, ROLE_LABEL } from './ai.js';
import { createWorld, stepWorld, summarize } from './sim.js';
import { EventRunner, newEvent, matchSettings } from './event.js';
import { EventUI } from './eventui.js';
import { Input } from './input.js';
import { MatchLog, robotName } from './log.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / 120;

// ---------- Settings ----------
const isTouchDevice = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
const DEFAULTS = { mode: 'match', alliance: 'blue', preset: 'balanced', allySkill: 'hard', oppSkill: 'einstein', allyTactic: 'balanced', oppTactic: 'random', camera: 'driver', control: 'auto', allyBots: ['random', 'random'], oppBots: ['random', 'random', 'random'], autoIntake: true, autoShoot: isTouchDevice, logMode: false, evSize: '32', evLevel: 'regional', team: 9999, shadows: !isTouchDevice, showRoles: true };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('simbotics.settings') || '{}')); } catch { /* storage unavailable */ }
const saveSettings = () => { try { localStorage.setItem('simbotics.settings', JSON.stringify(settings)); } catch { /* ignore */ } };
const touchMode = () => settings.control === 'touch' || (settings.control === 'auto' && isTouchDevice);

// ---------- Renderer / scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouchDevice ? 1.5 : 2));
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 28, 60);
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 120);

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x30333a, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(4, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 6, bottom: -6, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
scene.add(sun);
for (const x of [-6, 0, 6]) {
  const p = new THREE.PointLight(0xffffff, 18, 18, 1.6);
  p.position.set(x, 7, 0);
  scene.add(p);
}

const field = buildField(scene);
const input = new Input();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep roughly the landscape field of view across the screen when held upright.
  camera.fov = w >= h ? 60 : Math.min(88, (2 * Math.atan(Math.tan(Math.PI / 6) * 1.25 / camera.aspect) * 180) / Math.PI);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- World ----------
let world = null;
let paused = false;
let camMode = settings.camera;
const camState = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };

// cfg: the settings for this match (an event match passes its own lineup).
function newWorld(cfg = settings) {
  if (world) {
    scene.remove(world.fuel.mesh);
    world.fuel.mesh.geometry.dispose();
    for (const r of world.robots) { scene.remove(r.mesh); if (r.tag) scene.remove(r.tag); }
  }
  const mode = cfg.mode, me = cfg.alliance;
  world = createWorld(scene, field, cfg);
  world.cfg = cfg;
  world.log = cfg.logMode && mode !== 'practice' ? new MatchLog(world, cfg) : null;
  if (mode === 'match') {
    const t = world.brains[other(me)];
    setTimeout(() => toast(`對手：${t.skill.name} · ${TACTICS[t.tactic]}`, other(me)), 400);
  }
  camState.init = false;
  paused = false;
  $('results').hidden = true;
  $('pause').hidden = true;
  updateHudStatic();
  if (mode === 'practice') toast('自由練習 — HUB 永遠啟用', 'neutral');
}

// ---------- Simulation step ----------
let frameInput = { fx: 0, fy: 0, rot: 0, aim: null, shoot: false, intake: false };

// Auto-shoot: fire whenever we're in our zone with FUEL and the shot will land in an active HUB.
function autoShootNow(p) {
  const m = world.match;
  if (p.fuel <= 0 || p.climbing || !inZone(p.alliance, p.x)) return false;
  if (m.mode === 'practice') return true;
  const t = m.t + (p.turrets[0]?.shot?.T ?? 1) + 0.05;
  return m.hubActiveAt(p.alliance, t) || m.hubActiveAt(p.alliance, t - 2.6);
}

function controlFrame() {
  // Ground-plane "forward" for the current camera.
  const f = new THREE.Vector3();
  camera.getWorldDirection(f);
  f.y = 0;
  if (f.lengthSq() < 0.09) { f.copy(camera.up).applyQuaternion(camera.quaternion); f.y = 0; }
  f.normalize();
  return [f.x, f.z];
}

function step(dt) {
  const [fx, fz] = controlFrame();
  const inp = frameInput;
  const pcmd = {
    mx: fx * inp.fx + -fz * inp.fy,
    mz: fz * inp.fx + fx * inp.fy,
    rot: inp.rot,
    shoot: inp.shoot || (settings.autoShoot && autoShootNow(world.player)),
    intake: inp.intake || settings.autoIntake || touchMode(),
  };
  if (inp.aim) {
    // Aim stick: point the nose where the stick points, in the camera's ground frame.
    const dx = fx * -inp.aim[1] + -fz * inp.aim[0], dz = fz * -inp.aim[1] + fx * inp.aim[0];
    pcmd.heading = Math.atan2(-dz, dx);
    pcmd.headingGain = 4;
  } else if (pcmd.shoot && world.player.fixedShooter && Math.abs(inp.rot) < 0.1 && world.player.fuel > 0) {
    // Fixed shooters: shooting turns the chassis onto the target unless you're steering.
    pcmd.heading = world.player.aimHeading(); pcmd.headingGain = 8;
  }
  stepWorld(world, dt, pcmd);
}

// ---------- Camera ----------
function updateCamera(dt) {
  const r = world.player;
  const s = side(r.alliance);
  const k = camState.init ? Math.min(1, dt * 5) : 1;
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  camera.up.set(0, 1, 0);
  const tall = camera.aspect < 1;
  if (camMode === 'driver' && tall) {
    // Upright phone: stand higher and centred so the whole field width stays in view.
    pos.set(s * (HL + 1.2), 7.8, -s * 0.3);
    look.set(r.x * 0.55 - s * 2.6, 0, r.z * 0.35);
  } else if (camMode === 'driver') {
    pos.set(s * (HL + 2.0), 3.0, -s * 1.8);
    look.set(r.x * 0.5 - s * 2.0, 0, r.z * 0.5 - s * 0.6);
  } else if (camMode === 'chase') {
    let d = r.h - camState.yaw;
    d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    camState.yaw += camState.init ? d * Math.min(1, dt * 3) : d;
    const fx = Math.cos(camState.yaw), fz = -Math.sin(camState.yaw);
    const ry = r.y + r.climbY;
    pos.set(r.x - fx * 2.9, ry + 1.9, r.z - fz * 2.9);
    look.set(r.x + fx * 1.6, ry + 0.3, r.z + fz * 1.6);
  } else if (camMode === 'debug') {
    pos.copy(camState.dbgPos);
    look.copy(camState.dbgLook);
  } else if (tall) {
    // Upright phone: top-down with our wall at the bottom of the screen.
    camera.up.set(-s, 0, 0);
    pos.set(r.x * 0.25 + s * 0.6, 19, 0.001);
    look.set(r.x * 0.25, 0, 0);
  } else {
    pos.set(r.x * 0.3, 11.5, 9.8);
    look.set(r.x * 0.3, 0, 0.6);
  }
  camState.pos.lerp(pos, k);
  camState.look.lerp(look, k);
  camState.init = true;
  camera.position.copy(camState.pos);
  camera.lookAt(camState.look);
}

// ---------- HUD ----------
const fmt = (t) => { t = Math.ceil(t); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
let hudCache = {};
const setText = (id, v) => { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } };
const setClass = (id, cls, on) => $(id).classList.toggle(cls, on);

function updateHudStatic() {
  hudCache = {};
  const p = world.player;
  $('robot-name').textContent = `${p.number} · ${p.p.name}`;
  $('robot-card').style.setProperty('--ac', `#${COLORS[p.alliance].toString(16).padStart(6, '0')}`);
}

function toast(text, alliance) {
  const el = document.createElement('div');
  el.className = `toast ${alliance || ''}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2800);
}

function updateHud() {
  const { match, player } = world;
  const practice = match.mode === 'practice';
  setText('score-red', String(match.total('red')));
  setText('score-blue', String(match.total('blue')));
  let phase = { countdown: '準備', auto: 'Auto', pause: 'Auto 結束', teleop: '', post: '比賽結束', practice: '練習' }[match.phase];
  if (match.phase === 'teleop') phase = match.segment().name;
  setText('phase', phase);
  setText('clock', practice ? '∞' : match.phase === 'countdown' ? String(Math.ceil(match.countdownEnd - match.t)) : fmt(match.clock));

  for (const a of ['red', 'blue']) {
    const on = match.hubActive(a);
    const nt = match.nextToggle(a);
    const warn = nt !== null && nt <= 3 && on;
    setClass(`hub-${a}`, 'on', on);
    setClass(`hub-${a}`, 'warn', warn);
    setText(`hub-${a}-txt`, `${on ? '啟用' : '停用'}${nt !== null && nt < 30 ? ` · ${Math.ceil(nt)}s` : ''}`);
    // HUB lights on the field.
    const hub = field.hubs[a];
    const blink = warn && Math.floor(match.t * 4) % 2 === 0;
    hub.ledMat.emissiveIntensity = on ? (blink ? 0.2 : 1.8) : 0.05;
  }

  setText('fuel-count', `${player.fuel}`);
  setText('fuel-cap', `/ ${player.p.capacity}`);
  $('fuel-bar').style.width = `${(player.fuel / player.p.capacity) * 100}%`;
  setText('stat-scored', `${player.stats.scored}`);
  setText('stat-acc', player.stats.shots ? `${Math.round((player.stats.scored / player.stats.shots) * 100)}%` : '—');
  setText('intake-state', player.intakeOn ? 'Intake 開' : 'Intake 關');
  setClass('intake-state', 'on', !!player.intakeOn);
  setText('aim-state', player.aimMode === 'hub' ? '瞄準 HUB' : '傳球模式');
  setClass('aim-state', 'pass', player.aimMode !== 'hub');

  const touch = touchMode();
  const canClimb = player.inClimbZone(world) && match.enabled;
  if (touch) {
    $('t-climb').hidden = !(player.climbing || canClimb);
    $('t-down').hidden = !player.climbing;
  }
  let prompt = '';
  if (player.climbing) prompt = `TOWER 上 — ${player.climbLevel ? 'L' + player.climbLevel : '攀爬中…'}${touch ? '' : '   [C] 往上  [X] 往下'}`;
  else if (canClimb) prompt = touch ? '可以攀爬 TOWER' : '[C] 攀爬 TOWER';
  else if (player.aimMode === 'pass' && player.fuel > 0) prompt = '不在己方區域 — 射擊會變成傳球';
  else if (match.enabled && !match.hubActive(player.alliance) && player.fuel > 0) prompt = '己方 HUB 停用中 — 先囤積 FUEL';
  setText('prompt', prompt);
  $('prompt').hidden = !prompt;
}

function handleEvents() {
  const m = world.match;
  while (m.events.length) {
    const e = m.events.shift();
    if (e.type === 'phase') {
      if (e.phase === 'auto') toast('AUTO', 'neutral');
      if (e.phase === 'teleop') toast('TELEOP', 'neutral');
      if (e.phase === 'post') toast('比賽結束', 'neutral');
    } else if (e.type === 'autoWinner') {
      toast(`${e.alliance === 'red' ? '紅' : '藍'}聯盟贏得 AUTO — 其 HUB 先停用`, e.alliance);
    } else if (e.type === 'final') {
      showResults();
    }
  }
  if (m.phase === 'teleop') {
    const seg = m.segment().name;
    if (seg !== world.lastSeg) {
      world.lastSeg = seg;
      if (seg.startsWith('Shift')) {
        const act = ['red', 'blue'].filter((a) => m.hubActive(a));
        toast(`${seg}：${act.map((a) => (a === 'red' ? '紅' : '藍')).join('、')} HUB 啟用`, act.length === 1 ? act[0] : 'neutral');
      } else if (seg === 'Endgame') toast('ENDGAME — 兩邊 HUB 都啟用', 'neutral');
    }
  }
}

// Per-robot breakdown, our alliance first, best scorer on top.
function robotTable() {
  const me = world.player;
  const rows = [...world.robots].sort((x, y) => (x.alliance === me.alliance ? 0 : 1) - (y.alliance === me.alliance ? 0 : 1) || y.stats.scored - x.stats.scored);
  const body = rows.map((r) => {
    const st = r.stats;
    const acc = st.shots ? `${Math.round((st.scored / st.shots) * 100)}%` : '—';
    const name = robotName(r);
    return `<tr class="${r.alliance === 'red' ? 'ar' : 'ab'}${r.isPlayer ? ' me' : ''}">
      <td><b>${r.number}</b> <small>${name}</small>${r.isPlayer ? ' <small class="who">你</small>' : ''}</td>
      <td>${st.scored}</td><td>${st.shots}</td><td>${acc}</td><td>${st.passes}</td><td>${st.intaked}</td><td>${r.climbLevel ? 'L' + r.climbLevel : '—'}</td></tr>`;
  }).join('');
  return `<div class="robots"><table>
    <tr><th>機器人</th><th>進球</th><th>射出</th><th>命中</th><th>傳球</th><th>吸入</th><th>TOWER</th></tr>${body}</table></div>`;
}

function showResults() {
  const m = world.match;
  const row = (label, fn) => `<tr><td>${label}</td><td class="r">${fn('red')}</td><td class="b">${fn('blue')}</td></tr>`;
  const rp = { red: m.rankingPoints('red'), blue: m.rankingPoints('blue') };
  const rpTxt = (a) => {
    const x = rp[a];
    return `${x.win + x.energized + x.supercharged + x.traversal} <small>${[x.energized && 'E', x.supercharged && 'S', x.traversal && 'T'].filter(Boolean).join(' ')}</small>`;
  };
  const r = m.total('red'), b = m.total('blue');
  const winner = r > b ? '紅聯盟獲勝' : b > r ? '藍聯盟獲勝' : '平手';
  $('results-body').innerHTML = `
    <h2 class="${r > b ? 'r' : b > r ? 'b' : ''}">${winner}</h2>
    <table>
      <tr><th></th><th class="r">紅</th><th class="b">藍</th></tr>
      ${row('Auto FUEL', (a) => m.score[a].autoFuel)}
      ${row('Teleop FUEL', (a) => m.score[a].teleFuel)}
      ${row('Auto TOWER', (a) => m.score[a].autoTower)}
      ${row('結束 TOWER', (a) => m.score[a].teleTower)}
      <tr class="total"><td>總分</td><td class="r">${r}</td><td class="b">${b}</td></tr>
      ${row('Ranking Points', rpTxt)}
    </table>
    ${robotTable()}
    ${world.log ? `<div class="log"><div class="log-bar"><b>操作記錄</b><button id="btn-log-copy">複製</button><button id="btn-log-save">下載 .txt</button></div><textarea id="log-text" readonly></textarea></div>` : ''}
    <p class="hint">RP：E = Energized（≥100 FUEL）、S = Supercharged（≥360 FUEL）、T = Traversal（TOWER ≥50 分）<br>命中率 = 進球 ÷ 射向 HUB 的球；在己方區域外射出的球算傳球。</p>`;
  if (world.log) {
    const text = world.log.text();
    $('log-text').value = text;
    $('btn-log-copy').onclick = async () => {
      const btn = $('btn-log-copy');
      try { await navigator.clipboard.writeText(text); } catch { $('log-text').select(); document.execCommand('copy'); }
      btn.textContent = '已複製';
      setTimeout(() => { btn.textContent = '複製'; }, 1500);
    };
    $('btn-log-save').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = `simbotics-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }
  const ev = world.cfg.eventMatch;
  $('btn-again').hidden = !!ev;
  $('btn-results-menu').hidden = !!ev;
  $('btn-results-event').hidden = !ev;
  if (ev && !world.recorded) { world.recorded = true; runner.done(ev, summarize(world), true); }
  $('results').hidden = false;
}

// ---------- Menu ----------
function fillMenu() {
  const presetSel = $('opt-preset');
  const opts = (real) => Object.entries(ROBOT_PRESETS).filter(([, p]) => !!p.real === real).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
  presetSel.innerHTML = `<optgroup label="2026 真實機器人">${opts(true)}</optgroup><optgroup label="通用">${opts(false)}</optgroup>`;
  if (!ROBOT_PRESETS[settings.preset]) settings.preset = DEFAULTS.preset;
  const skillOpts = Object.entries(BOT_SKILL).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('opt-ally-skill').innerHTML = skillOpts;
  $('opt-opp-skill').innerHTML = skillOpts;
  const tacOpts = Object.entries(TACTICS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('opt-ally-tactic').innerHTML = tacOpts;
  $('opt-opp-tactic').innerHTML = `<option value="random">隨機</option>${tacOpts}`;
  for (const [id, key] of [['opt-control', 'control'], ['opt-mode', 'mode'], ['opt-alliance', 'alliance'], ['opt-preset', 'preset'], ['opt-ally-skill', 'allySkill'], ['opt-opp-skill', 'oppSkill'], ['opt-ally-tactic', 'allyTactic'], ['opt-opp-tactic', 'oppTactic'], ['opt-camera', 'camera'], ['opt-ev-size', 'evSize'], ['opt-ev-level', 'evLevel']]) {
    if (settings[key] === undefined || ![...$(id).options].some((o) => o.value === settings[key])) settings[key] = DEFAULTS[key];
    const el = $(id);
    el.value = settings[key];
    el.onchange = () => { settings[key] = el.value; saveSettings(); describe(); };
  }
  // Teammate / opponent robot pickers.
  const pickOpts = `<option value="random">隨機</option><optgroup label="2026 真實機器人">${opts(true)}</optgroup><optgroup label="通用">${opts(false)}</optgroup>`;
  for (const [key, n] of [['allyBots', 2], ['oppBots', 3]]) {
    settings[key] = [...(Array.isArray(settings[key]) && settings[key].length === n ? settings[key] : DEFAULTS[key])];
    for (let i = 0; i < n; i++) {
      const el = $(`opt-bot-${key === 'allyBots' ? 'ally' : 'opp'}-${i}`);
      el.innerHTML = pickOpts;
      if (!ROBOT_PRESETS[settings[key][i]]) settings[key][i] = 'random';
      el.value = settings[key][i];
      el.onchange = () => { settings[key][i] = el.value; saveSettings(); };
    }
  }
  $('opt-team').value = settings.team;
  $('opt-team').onchange = () => { settings.team = Math.max(1, Math.min(99999, parseInt($('opt-team').value, 10) || 9999)); $('opt-team').value = settings.team; saveSettings(); };
  $('opt-intake').checked = settings.autoIntake;
  $('opt-intake').onchange = () => { settings.autoIntake = $('opt-intake').checked; saveSettings(); };
  $('opt-shoot').checked = settings.autoShoot;
  $('opt-shoot').onchange = () => { settings.autoShoot = $('opt-shoot').checked; saveSettings(); };
  $('opt-log').checked = settings.logMode;
  $('opt-log').onchange = () => { settings.logMode = $('opt-log').checked; saveSettings(); };
  $('opt-roles').checked = settings.showRoles;
  $('opt-roles').onchange = () => { settings.showRoles = $('opt-roles').checked; saveSettings(); };
  $('opt-shadows').checked = settings.shadows;
  $('opt-shadows').onchange = () => {
    settings.shadows = $('opt-shadows').checked; saveSettings();
    renderer.shadowMap.enabled = settings.shadows;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  };
  describe();
}

function describe() {
  const pr = ROBOT_PRESETS[settings.preset];
  $('preset-desc').textContent = `${pr.desc}  容量 ${pr.capacity} · 射速 ${pr.fireRate}/秒 · 最高 L${pr.climbMax}${pr.fitsTrench ? ' · 可鑽 TRENCH' : ''}`;
  $('opt-team').disabled = !!pr.team;
  if (pr.team) $('opt-team').value = pr.team; else $('opt-team').value = settings.team;
  for (const el of document.querySelectorAll('.bot-opt, .event-opt')) {
    el.hidden = !(el.classList.contains('bot-opt') && settings.mode === 'match' || el.classList.contains('event-opt') && settings.mode === 'event');
  }
  $('btn-start').textContent = settings.mode === 'event' && runner.ev ? '繼續賽事' : '開始';
  document.body.classList.toggle('touch', touchMode());
}

function startGame() {
  $('menu').hidden = true;
  if (settings.mode === 'event') {
    if (!runner.ev) {
      const pr = ROBOT_PRESETS[settings.preset];
      runner.start(newEvent(+settings.evSize, settings.evLevel, { preset: settings.preset, number: pr.team ?? settings.team }));
    }
    paused = true;
    eventUI.show();
    return;
  }
  // Phones: go fullscreen where the browser allows it (not on iPhone Safari).
  if (touchMode() && document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  camMode = settings.camera;
  newWorld();
  input.clearEdges();
}

// ---------- Events ----------
const runner = new EventRunner(() => eventUI.refresh());
const eventUI = new EventUI(runner, {
  play(id) {
    const { settings: cfg } = matchSettings(runner.ev, id, settings);
    cfg.eventMatch = id;
    if (touchMode() && document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    camMode = settings.camera;
    newWorld(cfg);
    input.clearEdges();
  },
  menu() { $('menu').hidden = false; paused = true; describe(); },
});
const toEvent = () => { $('results').hidden = true; $('pause').hidden = true; paused = true; eventUI.show(); };

$('btn-start').onclick = startGame;
$('btn-resume').onclick = () => { paused = false; $('pause').hidden = true; };
$('btn-restart').onclick = () => newWorld(world.cfg);
$('btn-menu').onclick = () => { if (world.cfg.eventMatch) { toEvent(); return; } $('pause').hidden = true; $('menu').hidden = false; paused = true; };
$('btn-again').onclick = () => newWorld(world.cfg);
$('btn-results-event').onclick = toEvent;
$('btn-results-menu').onclick = () => { $('results').hidden = true; $('menu').hidden = false; paused = true; };
$('btn-help').onclick = () => { $('help').hidden = !$('help').hidden; };
$('t-full').hidden = !document.fullscreenEnabled;
$('t-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); };
fillMenu();

// ---------- Loop ----------
let last = performance.now();
let acc = 0;
const fps = { n: 0, t: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (world && $('menu').hidden && $('event').hidden) {
    if (input.pressed('Escape') || input.pressed('KeyP')) {
      if ($('results').hidden) { paused = !paused; $('pause').hidden = !paused; }
    }
    if (input.pressed('KeyV')) {
      const modes = ['driver', 'chase', 'broadcast'];
      camMode = modes[(modes.indexOf(camMode) + 1) % modes.length];
      camState.init = false;
      toast(`鏡頭：${{ driver: 'Driver Station', chase: '跟車', broadcast: '轉播' }[camMode]}`, 'neutral');
    }
    if (input.pressed('KeyR') && !world.recorded) newWorld(world.cfg);
    if (input.pressed('KeyH')) $('help').hidden = !$('help').hidden;
    if (input.pressed('KeyI')) { settings.autoIntake = !settings.autoIntake; saveSettings(); $('opt-intake').checked = settings.autoIntake; }
    if (input.pressed('KeyC')) world.player.requestClimb(world);
    if (input.pressed('KeyX')) world.player.descend();

    if (!paused) {
      frameInput = input.read();
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 12) { step(STEP); acc -= STEP; n++; }
      if (n === 12) acc = 0;
      handleEvents();
    }
    for (const b of world.bots) b.r.setTag(settings.showRoles ? ROLE_LABEL[b.role] : null, b.r.alliance === world.player.alliance ? '#bfe3ff' : '#ffc2c6');
    for (const r of world.robots) r.syncMesh(dt);
    world.fuel.render();
    updateCamera(dt);
    updateHud();
  } else if (!world) {
    // Idle orbit behind the menu.
    const a = now / 9000;
    camera.position.set(Math.cos(a) * 12, 7, Math.sin(a) * 9);
    camera.lookAt(0, 0, 0);
  } else {
    input.clearEdges();
  }

  document.body.classList.toggle('in-menu', !$('menu').hidden || !$('event').hidden);
  fps.n++; fps.t += dt;
  if (fps.t > 0.5) { $('fps').textContent = `${Math.round(fps.n / fps.t)} fps`; fps.n = 0; fps.t = 0; }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Expose for debugging in the console.
window.sim = {
  get world() { return world; },
  settings,
  input,
  runner,
  step(n = 1, cmd) { if (cmd) frameInput = { fx: 0, fy: 0, rot: 0, aim: null, shoot: false, intake: false, ...cmd }; for (let i = 0; i < n; i++) step(STEP); handleEvents(); },
  cam(m) { camMode = m; camState.init = false; },
  view(p, l) { camMode = 'debug'; camState.dbgPos = new THREE.Vector3(...p); camState.dbgLook = new THREE.Vector3(...l); camState.init = false; },
  draw() { for (const r of world.robots) r.syncMesh(1 / 30); world.fuel.render(); updateCamera(1 / 30); updateHud(); renderer.render(scene, camera); },
};
