import * as THREE from './three.js';
import { ROBOT_PRESETS } from './config.js';
import { buildRobotModel } from './models.js';
import { shotRange } from './robot.js';
import { SLOTS, WEIGHT_LIMIT, PAINT_NAMES, MOTORS, INDEXERS, DIRS, RANGES, RULES, defaultBuild, defaultAdvanced, advanced, compile, weight, presetKey, loadBuilds, saveBuilds, registerBuilds } from './parts.js';

// Robot builder screen. Simple mode: pick one mechanism per slot. Advanced mode: set sizes, gearing,
// flywheel speed, indexer and every shooter's position as numbers. Live 3D preview and stats.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Builder {
  // onUse(key): the player picked this robot; onClose(): back to the menu.
  constructor({ onUse, onClose, team }) {
    this.onUse = onUse;
    this.onClose = onClose;
    this.team = team;
    this.build = null;
    this.alliance = 'blue';
    this.renderer = null;
    this.model = null;
    this.career = null;   // career mode CAD: { cb(build | null), team }
    $('builder').addEventListener('click', (e) => this.click(e));
    $('builder').addEventListener('change', (e) => this.change(e));
    $('builder').addEventListener('input', (e) => {
      if (e.target.id === 'b-name') { this.build.name = e.target.value; this.stats(); return; }
      if (e.target.type === 'range') this.slide(e.target);
    });
  }

  get open() { return !$('builder').hidden; }

  show(key) {
    this.career = null;
    const list = loadBuilds();
    const cur = list.find((b) => presetKey(b) === key) || list[0];
    this.build = cur ? structuredClone(cur) : defaultBuild();
    $('builder').hidden = false;
    this.render();
    this.initView();
  }

  // Career mode: edit the season robot (advanced mode only); cb gets the saved build, or null.
  showCareer(build, team, cb) {
    this.career = { cb, team };
    this.build = structuredClone(build);
    this.build.adv ??= defaultAdvanced();
    $('builder').hidden = false;
    this.render();
    this.initView();
  }

  hide() { $('builder').hidden = true; }

  render() {
    const list = loadBuilds(), b = this.build;
    const saved = list.some((x) => x.id === b.id);
    const slots = b.adv ? '' : Object.entries(SLOTS).map(([slot, s]) => `<label>${s.label}
      <select data-slot="${slot}">${Object.entries(s.options).map(([k, o]) => `<option value="${k}"${b.parts[slot] === k ? ' selected' : ''}>${o.name}（${o.w} lb）</option>`).join('')}</select></label>`).join('');
    $('builder').querySelector('[data-act=use]').hidden = !!this.career;
    if (this.career) $('b-list').innerHTML = '<span class="muted">生涯模式 CAD：存檔後改到的子系統要重做</span>';
    else $('b-list').innerHTML = `<select id="b-pick">${list.map((x) => `<option value="${x.id}"${x.id === b.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}${saved ? '' : `<option value="${b.id}" selected>（新的）${esc(b.name)}</option>`}</select>
      <button data-act="new">新增</button>${saved ? '<button data-act="delete">刪除</button>' : ''}`;
    $('b-form').innerHTML = `
      ${this.career ? '' : `<div class="b-mode"><button data-act="mode" data-mode="simple" class="${b.adv ? '' : 'on'}">簡易</button><button data-act="mode" data-mode="adv" class="${b.adv ? 'on' : ''}">進階</button></div>`}
      <div class="grid">
        <label>名稱<input id="b-name" type="text" maxlength="24" value="${esc(b.name)}"></label>
        <label>塗裝<select id="b-color">${Object.entries(PAINT_NAMES).map(([k, n]) => `<option value="${k}"${b.color === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        ${b.adv ? '' : slots}
      </div>
      ${b.adv ? this.advForm() : ''}
      <div id="b-stats"></div>`;
    this.stats();
  }

  stats() {
    const b = this.build, p = compile(b), w = weight(b), over = w - WEIGHT_LIMIT;
    const fmt = (v, d = 1) => (+v).toFixed(d);
    const A = b.adv ? advanced(b.adv) : null;
    const errors = A ? A.errors : over > 0 ? [`超重 ${over} lb`] : [];
    const range = p.shotSpeed ? shotRange(p.shotSpeed, p.height + 0.1) : null;
    $('b-stats').innerHTML = `
      <div class="b-weight ${over > 0 ? 'over' : ''}"><div class="bar"><div style="width:${Math.min(100, (w / WEIGHT_LIMIT) * 100)}%"></div></div>
        <span>${fmt(w)} / ${WEIGHT_LIMIT} lb</span></div>
      ${A ? `<div class="b-parts">${A.parts.map(([k, v]) => `<span>${k} <b>${fmt(v)}</b></span>`).join('')}</div>` : ''}
      ${errors.length ? `<ul class="b-err">${errors.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
      <table>
        <tr><td>最高速度</td><td>${fmt(p.maxSpeed)} m/s</td><td>加速度</td><td>${fmt(p.accel)} m/s²</td></tr>
        <tr><td>容量</td><td>${p.capacity} 顆</td><td>射速</td><td>${p.fireRate} 顆/秒</td></tr>
        <tr><td>Intake 寬度</td><td>${Math.round(p.intakeW * 200)} cm</td><td>吸球速度</td><td>${p.intakeRate} 顆/秒</td></tr>
        <tr><td>TRENCH</td><td>${p.fitsTrench ? '鑽得過' : '鑽不過'}</td><td>攀爬</td><td>${p.climbMax ? 'L' + p.climbMax : '不爬'}</td></tr>
        ${A ? `<tr><td>射程</td><td>${range < 0.6 ? '射不到 HUB' : fmt(range) + ' m'}</td><td>高度</td><td>${fmt(A.height)} in</td></tr>
        <tr><td>周長</td><td>${fmt(A.perim)} in</td><td>轉向</td><td>${fmt(p.maxOmega)} rad/s</td></tr>` : ''}
      </table>
      <p class="muted">${p.turrets.some((t) => t.fixed !== undefined) ? '固定式射手：射擊時車頭要轉向 HUB（電腦和自動瞄準會幫你轉）。' : '砲塔會自動瞄準 HUB。'}${A ? '射程由飛輪轉速決定，離 HUB 太遠射不進（電腦會自己靠近）。己方區域離 HUB 最遠約 6 m。' : '越輕加速越快。'}重量上限 ${WEIGHT_LIMIT} lb（不含 bumper 和電池）。</p>`;
    for (const el of document.querySelectorAll('#builder [data-act=use], #builder [data-act=save]')) el.disabled = errors.length > 0;
  }

  // ---------- Advanced form ----------
  advForm() {
    const a = this.build.adv, round = a.shape === 'round';
    const L = round ? a.diameter : a.length, W = round ? a.diameter : a.width;
    const sel = (k, opts, num = false) => {
      const cur = String(k === 'count' ? a.shooters.length : a[k]);
      return `<select data-a="${k}"${num ? ' data-num="1"' : ''}>${Object.entries(opts).map(([v, n]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
    };
    const rng = (k, label, unit, r = RANGES[k], v = a[k]) => `<label>${label} <b data-show="${k}">${v} ${unit}</b><input type="range" data-a="${k}" data-unit="${unit}" min="${r[0]}" max="${r[1]}" step="${r[2]}" value="${v}"></label>`;
    const fixed = a.shooterType === 'fixed';
    const shooters = a.shooters.map((sh, i) => {
      const x = `<label>前後 <b data-show="s${i}x">${sh.x} in</b><input type="range" data-sh="${i}" data-f="x" data-unit="in" min="${-(L / 2 - 2)}" max="${L / 2 - 2}" step="0.5" value="${sh.x}"></label>`;
      const z = `<label>左右 <b data-show="s${i}z">${sh.z} in</b><input type="range" data-sh="${i}" data-f="z" data-unit="in" min="${-(W / 2 - 2)}" max="${W / 2 - 2}" step="0.5" value="${sh.z}"></label>`;
      const wd = fixed ? `<label>滾筒寬度 <b data-show="s${i}width">${sh.width} in</b><input type="range" data-sh="${i}" data-f="width" data-unit="in" min="${RANGES.shooterWidth[0]}" max="${RANGES.shooterWidth[1]}" step="0.5" value="${sh.width}"></label>` : '';
      return `<div class="b-shooter"><span>射手 ${i + 1}</span>${x}${z}${wd}</div>`;
    }).join('');
    return `
      <h4>底盤</h4><div class="grid">
        <label>形狀${sel('shape', { rect: '方形／長方形', round: '圓形' })}</label>
        ${round ? rng('diameter', '直徑', 'in') : rng('length', '長（前後）', 'in') + rng('width', '寬（左右）', 'in')}
      </div>
      <h4>驅動</h4><div class="grid">
        <label>類型${sel('drive', { swerve: 'Swerve', mecanum: 'Mecanum' })}</label>
        <label>馬達${sel('motor', Object.fromEntries(Object.entries(MOTORS).map(([k, m]) => [k, m.name])))}</label>
        ${rng('ratio', '齒比', ': 1')}
      </div>
      <h4>Intake</h4><div class="grid">
        ${rng('intakeWidth', '寬度', 'in')}${rng('intakeExt', '伸出距離', 'in')}${rng('intakeRpm', '滾輪轉速', 'RPM')}
      </div>
      <h4>Hopper 與 Indexer</h4><div class="grid">
        ${rng('hopperHeight', 'Hopper 高度', 'in')}
        <label>Indexer${sel('indexer', Object.fromEntries(Object.entries(INDEXERS).map(([k, x]) => [k, `${x.name}（${x.feed} 顆/秒）`])))}</label>
        <label class="b-check"><input type="checkbox" data-a="expand"${a.expand ? ' checked' : ''}> 可展開（多 8 in，收起時才鑽 TRENCH）</label>
      </div>
      <h4>射手</h4><div class="grid">
        <label>類型${sel('shooterType', { turret: '砲塔', fixed: '固定式滾筒' })}</label>
        <label>數量${sel('count', { 1: '1 座', 2: '2 座', 3: '3 座' }, true)}</label>
        ${fixed ? `<label>方向${sel('fixedDir', Object.fromEntries(Object.entries(DIRS).map(([k, d]) => [k, d.name])))}</label>` : `<label>飛輪${sel('wheels', { 1: '單飛輪（7 顆/秒）', 2: '雙飛輪（10 顆/秒）' }, true)}</label>`}
        ${rng('rpm', '飛輪轉速', 'RPM')}
      </div>
      <div class="b-shooters">${shooters}</div>
      <h4>攀爬</h4><div class="grid">
        <label>層數${sel('climb', { 0: '不爬', 1: 'L1', 2: 'L2', 3: 'L3' }, true)}</label>
        ${rng('climbSpeed', '爬升速度', 'm/s')}
      </div>`;
  }

  // Shooters spread evenly for the current type and count.
  layoutShooters(n) {
    const a = this.build.adv, round = a.shape === 'round';
    const L = round ? a.diameter : a.length, W = round ? a.diameter : a.width;
    const fixed = a.shooterType === 'fixed', side = a.fixedDir !== 'rear';
    const span = side ? L : W, w = Math.max(4, Math.floor((span - 4) / n));
    a.shooters = Array.from({ length: n }, (_, i) => {
      const off = (i - (n - 1) / 2) * (span - 4) / n;
      if (!fixed) return { x: -4, z: n === 1 ? 0 : Math.round(off * 2) / 2, width: 18 };
      if (!side) return { x: -(L / 2 - 4), z: Math.round(off * 2) / 2, width: Math.min(w, 22) };
      return { x: Math.round(off * 2) / 2, z: (a.fixedDir === 'left' ? 1 : -1) * (W / 2 - 4), width: Math.min(w, 22) };
    });
  }

  slide(el) {
    const a = this.build.adv, v = +el.value;
    if (el.dataset.sh !== undefined) a.shooters[+el.dataset.sh][el.dataset.f] = v;
    else a[el.dataset.a] = v;
    const key = el.dataset.sh !== undefined ? `s${el.dataset.sh}${el.dataset.f}` : el.dataset.a;
    const show = $('b-form').querySelector(`[data-show="${key}"]`);
    if (show) show.textContent = `${v} ${el.dataset.unit}`;
    this.stats();
    this.queueModel();
  }

  queueModel() {
    if (this.modelQueued) return;
    this.modelQueued = true;
    requestAnimationFrame(() => { this.modelQueued = false; this.refreshModel(); });
  }

  change(e) {
    const t = e.target, b = this.build;
    if (t.type === 'range' && ['length', 'width', 'diameter'].includes(t.dataset.a)) {
      // Frame size changed: keep shooters on the robot and rebuild the position sliders.
      const a = b.adv, round = a.shape === 'round';
      const L = round ? a.diameter : a.length, W = round ? a.diameter : a.width;
      for (const sh of a.shooters) {
        sh.x = Math.max(-(L / 2 - 2), Math.min(L / 2 - 2, sh.x));
        sh.z = Math.max(-(W / 2 - 2), Math.min(W / 2 - 2, sh.z));
      }
      this.render(); this.refreshModel(); return;
    }
    if (t.dataset.a && t.type !== 'range') {
      const a = b.adv, k = t.dataset.a;
      if (k === 'count') this.layoutShooters(+t.value);
      else {
        a[k] = t.type === 'checkbox' ? t.checked : t.dataset.num ? +t.value : t.value;
        if (k === 'shooterType' || k === 'fixedDir' || k === 'shape') this.layoutShooters(a.shooters.length);
        if (k === 'shape') a.diameter ??= 28;
      }
      // Some picks change which inputs exist.
      if (['count', 'shooterType', 'fixedDir', 'shape'].includes(k)) { this.render(); this.refreshModel(); return; }
    } else if (t.dataset.slot) b.parts[t.dataset.slot] = t.value;
    else if (t.id === 'b-color') b.color = t.value;
    else if (t.id === 'b-pick') {
      const x = loadBuilds().find((y) => y.id === t.value);
      if (x) this.build = structuredClone(x);
      this.render();
      this.initView();
      return;
    } else return;
    this.stats();
    this.refreshModel();
  }

  click(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (this.career && (act === 'close' || act === 'save')) {
      const cb = this.career.cb;
      this.hide();
      cb(act === 'save' ? structuredClone({ ...this.build, name: this.build.name.trim() || '我的機器人' }) : null);
      return;
    }
    if (act === 'close') { this.hide(); this.onClose(); }
    if (act === 'side') { this.alliance = this.alliance === 'blue' ? 'red' : 'blue'; el.textContent = `${this.alliance === 'blue' ? '藍' : '紅'}聯盟配色`; this.refreshModel(); }
    if (act === 'mode') {
      if (el.dataset.mode === 'adv' && !this.build.adv) this.build.adv = defaultAdvanced();
      if (el.dataset.mode === 'simple') delete this.build.adv;
      this.render(); this.refreshModel();
    }
    if (act === 'new') { this.build = defaultBuild(); this.render(); this.initView(); }
    if (act === 'delete') {
      if (!confirm(`刪除「${this.build.name}」？`)) return;
      saveBuilds(loadBuilds().filter((x) => x.id !== this.build.id));
      delete ROBOT_PRESETS[presetKey(this.build)];
      const list = loadBuilds();
      this.build = list[0] ? structuredClone(list[0]) : defaultBuild();
      this.render(); this.initView();
    }
    if (act === 'save' || act === 'use') {
      const b = this.build;
      b.name = b.name.trim() || '我的機器人';
      const list = loadBuilds(), i = list.findIndex((x) => x.id === b.id);
      if (i >= 0) list[i] = structuredClone(b); else list.push(structuredClone(b));
      saveBuilds(list);
      registerBuilds([b]);
      if (act === 'use') { this.hide(); this.onUse(presetKey(b)); } else { this.render(); this.initView(); }
    }
  }

  // ---------- 3D preview ----------
  initView() {
    if (!this.scene) {
      this.renderer = new THREE.WebGLRenderer({ canvas: $('builder-view'), antialias: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      const s = this.scene = new THREE.Scene();
      s.background = new THREE.Color(0x0e1116);
      s.add(new THREE.HemisphereLight(0xdfe8ff, 0x30333a, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8);
      sun.position.set(2, 4, 3);
      s.add(sun);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9 }));
      floor.rotation.x = -Math.PI / 2;
      s.add(floor);
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 20);
    }
    this.refreshModel();
    if (!this.looping) { this.looping = true; requestAnimationFrame((t) => this.loop(t)); }
  }

  refreshModel() {
    if (!this.scene) return;
    if (this.model) { this.scene.remove(this.model); this.model.traverse((o) => { if (o.isInstancedMesh) return; o.geometry?.dispose(); for (const m of [o.material].flat()) { m?.map?.dispose(); m?.dispose(); } }); }
    const p = compile(this.build);
    const m = buildRobotModel({ p, alliance: this.alliance, number: this.career?.team ?? this.team(), isPlayer: false });
    m.fill.mesh.count = m.fill.spots;
    if (m.slide) m.slide.position.x = p.intakeDeploy;
    this.model = m.group;
    this.height = p.height;
    this.scene.add(this.model);
  }

  loop(t) {
    if (!this.open) { this.looping = false; return; }
    requestAnimationFrame((x) => this.loop(x));
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * this.renderer.getPixelRatio()) || c.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
    const a = t / 4000;
    const d = 2.3 + (this.height || 0.5);
    this.camera.position.set(Math.cos(a) * d, 0.9 + (this.height || 0.5), Math.sin(a) * d);
    this.camera.lookAt(0, 0.32, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
