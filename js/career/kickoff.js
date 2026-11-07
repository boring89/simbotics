import * as THREE from '../three.js';
import { buildField } from '../field.js';
import { createWorld, stepWorld } from '../sim.js';
import { HL, HUB_X } from '../config.js';

// The season reveal: a simulated kickoff broadcast. A real match plays in the background while
// the camera tours the field and captions explain the game. Space / Esc skips.

const SHOTS = [
  // [seconds, caption title, caption text, camera from, camera look]
  [5, '2026 賽季 Kickoff', '全世界的隊伍同時收看。今年的遊戲是……', [0, 22, 0.01], [0, 0, 0]],
  [6, 'REBUILT', '兩個三隊聯盟，2 分 40 秒的比賽。', [-14, 9, 11], [0, 0, 0]],
  [8, '把 FUEL 射進己方 HUB', '場上有幾百顆 FUEL。撿起來，從己方區域射進自己的 HUB，每顆 1 分。', [-HUB_X - 4, 3.2, 3.5], [-HUB_X, 1.4, 0]],
  [8, 'HUB 會輪流啟用', '20 秒 AUTO 之後，兩邊的 HUB 每 25 秒輪流啟用。停用時射進去不算分，要先囤球。最後 30 秒兩邊都啟用。', [0, 7, 9], [0, 0.5, 0]],
  [7, 'TOWER：最後的攀爬', '比賽結束前爬上 TOWER：L1 10 分、L2 20 分、L3 30 分。AUTO 時爬上 L1 有 15 分。', [HL - 4.5, 2.4, -3.2], [HL - 1, 1, -0.3]],
  [7, 'TRENCH 與 BUMP', '場地中間有凸起的 BUMP，兩側有低矮的 TRENCH。機器人夠矮（22.25 in 以下）才鑽得過 TRENCH。', [-4, 1.4, 5.5], [-3.6, 0.3, 3]],
  [7, '機器人規則', '框架周長不超過 110 in，高度不超過 30 in，重量不超過 115 lb（不含 bumper 與電池）。', [3, 2.2, 3], [5, 0.4, 0]],
  [6, 'Build Season 開始！', '3/2 晚上機器人要裝箱出發。回到工作室，打開電腦，開始設計吧。', [0, 26, 0.01], [0, 0, 0]],
];

export class Kickoff {
  constructor(renderer, onDone) {
    this.renderer = renderer;
    this.onDone = onDone;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x05070b);
    s.fog = new THREE.Fog(0x05070b, 30, 70);
    s.add(new THREE.HemisphereLight(0xdfe8ff, 0x30333a, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(4, 14, 6);
    s.add(sun);
    for (const x of [-6, 0, 6]) { const p = new THREE.PointLight(0xffffff, 18, 18, 1.6); p.position.set(x, 7, 0); s.add(p); }
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 150);
    const field = buildField(s);
    this.world = createWorld(s, field, { mode: 'match', alliance: 'blue', preset: 'balanced', team: 1, allySkill: 'einstein', oppSkill: 'einstein', allyTactic: 'balanced', oppTactic: 'balanced', allyBots: ['random', 'random'], oppBots: ['random', 'random', 'random'] }, 'einstein');
    this.field = field;
    this.t = 0;
    this.total = SHOTS.reduce((a, s) => a + s[0], 0);
    this.el = document.getElementById('kickoff');
    this.el.hidden = false;
    this.el.innerHTML = '<div class="ko-cap"><h2></h2><p></p></div><div class="ko-skip">Space／Esc 跳過</div><div class="ko-bar"><i></i></div>';
    this.cap = this.el.querySelector('.ko-cap');
    this.shot = -1;
    this.from = new THREE.Vector3(); this.look = new THREE.Vector3();
  }

  update(dt) {
    this.t += dt;
    // The match runs in fast-forward so the robots are always busy.
    for (let i = 0; i < 10; i++) stepWorld(this.world, 1 / 120, {});
    for (const r of this.world.robots) r.syncMesh(dt);
    this.world.fuel.render();
    for (const a of ['red', 'blue']) this.field.hubs[a].ledMat.emissiveIntensity = this.world.match.hubActive(a) ? 1.8 : 0.05;
    let acc = 0, k = 0;
    while (k < SHOTS.length - 1 && this.t > acc + SHOTS[k][0]) { acc += SHOTS[k][0]; k++; }
    const [len, title, text, from, look] = SHOTS[k];
    const u = Math.min(1, (this.t - acc) / len);
    if (k !== this.shot) {
      this.shot = k;
      this.cap.classList.remove('in');
      void this.cap.offsetWidth;
      this.cap.querySelector('h2').textContent = title;
      this.cap.querySelector('p').textContent = text;
      this.cap.classList.add('in');
      this.cap.classList.toggle('big', k === 1 || k === SHOTS.length - 1);
    }
    // Slow push-in on each shot.
    const f = new THREE.Vector3(...from), l = new THREE.Vector3(...look);
    const pos = f.clone().lerp(l, 0.12 * u);
    if (k === 1) pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), u * 0.6);
    this.camera.position.copy(pos);
    this.camera.lookAt(l);
    this.el.querySelector('.ko-bar i').style.width = `${Math.min(100, (this.t / this.total) * 100)}%`;
    if (this.t >= this.total) this.finish();
  }

  render() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  finish() {
    if (this.over) return;
    this.over = true;
    this.el.hidden = true;
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    this.onDone();
  }
}
