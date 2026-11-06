import * as THREE from './three.js';
import { ROBOT_PRESETS } from './config.js';
import { buildRobotModel } from './models.js';
import { SLOTS, WEIGHT_LIMIT, PAINT_NAMES, defaultBuild, compile, weight, presetKey, loadBuilds, saveBuilds, registerBuilds } from './parts.js';

// Robot builder screen: pick one mechanism per slot, see the robot and its numbers, save it.

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
    $('builder').addEventListener('click', (e) => this.click(e));
    $('builder').addEventListener('change', (e) => this.change(e));
    $('builder').addEventListener('input', (e) => { if (e.target.id === 'b-name') { this.build.name = e.target.value; this.stats(); } });
  }

  get open() { return !$('builder').hidden; }

  show(key) {
    const list = loadBuilds();
    const cur = list.find((b) => presetKey(b) === key) || list[0];
    this.build = cur ? structuredClone(cur) : defaultBuild();
    $('builder').hidden = false;
    this.render();
    this.initView();
  }

  hide() { $('builder').hidden = true; }

  render() {
    const list = loadBuilds(), b = this.build;
    const saved = list.some((x) => x.id === b.id);
    const slots = Object.entries(SLOTS).map(([slot, s]) => `<label>${s.label}
      <select data-slot="${slot}">${Object.entries(s.options).map(([k, o]) => `<option value="${k}"${b.parts[slot] === k ? ' selected' : ''}>${o.name}（${o.w} lb）</option>`).join('')}</select></label>`).join('');
    $('b-list').innerHTML = `<select id="b-pick">${list.map((x) => `<option value="${x.id}"${x.id === b.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}${saved ? '' : `<option value="${b.id}" selected>（新的）${esc(b.name)}</option>`}</select>
      <button data-act="new">新增</button>${saved ? '<button data-act="delete">刪除</button>' : ''}`;
    $('b-form').innerHTML = `
      <div class="grid">
        <label>名稱<input id="b-name" type="text" maxlength="24" value="${esc(b.name)}"></label>
        <label>塗裝<select id="b-color">${Object.entries(PAINT_NAMES).map(([k, n]) => `<option value="${k}"${b.color === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        ${slots}
      </div>
      <div id="b-stats"></div>`;
    this.stats();
  }

  stats() {
    const b = this.build, p = compile(b), w = weight(b), over = w - WEIGHT_LIMIT;
    const fmt = (v, d = 1) => (+v).toFixed(d);
    $('b-stats').innerHTML = `
      <div class="b-weight ${over > 0 ? 'over' : ''}"><div class="bar"><div style="width:${Math.min(100, (w / WEIGHT_LIMIT) * 100)}%"></div></div>
        <span>${w} / ${WEIGHT_LIMIT} lb${over > 0 ? `，超重 ${over} lb` : ''}</span></div>
      <table>
        <tr><td>最高速度</td><td>${fmt(p.maxSpeed)} m/s</td><td>加速度</td><td>${fmt(p.accel)} m/s²</td></tr>
        <tr><td>容量</td><td>${p.capacity} 顆</td><td>射速</td><td>${p.fireRate} 顆/秒</td></tr>
        <tr><td>Intake 寬度</td><td>${Math.round(p.intakeW * 200)} cm</td><td>吸球速度</td><td>${p.intakeRate} 顆/秒</td></tr>
        <tr><td>TRENCH</td><td>${p.fitsTrench ? '鑽得過' : '鑽不過'}</td><td>攀爬</td><td>${p.climbMax ? 'L' + p.climbMax : '不爬'}</td></tr>
      </table>
      <p class="muted">${p.turrets.some((t) => t.fixed !== undefined) ? '固定式射手：射擊時車頭要轉向 HUB（電腦和自動瞄準會幫你轉）。' : '砲塔會自動瞄準 HUB。'}越輕加速越快。重量上限照 FRC 規則（不含 bumper 和電池）。</p>`;
    const can = over <= 0;
    for (const el of document.querySelectorAll('#builder [data-act=use], #builder [data-act=save]')) el.disabled = !can;
  }

  change(e) {
    const t = e.target, b = this.build;
    if (t.dataset.slot) b.parts[t.dataset.slot] = t.value;
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
    if (act === 'close') { this.hide(); this.onClose(); }
    if (act === 'side') { this.alliance = this.alliance === 'blue' ? 'red' : 'blue'; el.textContent = `${this.alliance === 'blue' ? '藍' : '紅'}聯盟配色`; this.refreshModel(); }
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
    const m = buildRobotModel({ p, alliance: this.alliance, number: this.team(), isPlayer: false });
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
