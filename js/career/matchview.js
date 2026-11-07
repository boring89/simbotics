import * as THREE from '../three.js';
import { createWorld, stepWorld, summarize } from '../sim.js';
import { HL } from '../config.js';

// A match played out on the venue's field: ours (you drive from the driver station, or our driver
// bot does) or someone else's that you watch from the stands. Runs at real time.

const STEP = 1 / 120;

export class LiveMatch {
  // settings: createWorld settings (event.matchSettings); human: you drive our robot.
  constructor(scene, field, settings, { human = false, playerBot = 'hard', id }) {
    this.scene = scene;
    this.id = id;
    this.human = human;
    this.world = createWorld(scene, field, settings, human ? null : playerBot);
    this.field = field;
    this.color = settings.alliance;
    this.acc = 0;
    this.keys = new Set();
    this.mouse = false;
    this.post = 0;
    this.cam = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.camInit = false;
  }

  key(code, down) {
    if (down) this.keys.add(code); else this.keys.delete(code);
    const p = this.world.player;
    if (down && code === 'KeyC') p.requestClimb(this.world);
    if (down && code === 'KeyX') p.descend();
  }

  // Returns true once the match is over and the FUEL has settled.
  update(dt, camera) {
    const w = this.world, p = w.player;
    let cmd = {};
    if (this.human) {
      const k = (c) => this.keys.has(c);
      const fx = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0), fy = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
      const f = new THREE.Vector3();
      camera.getWorldDirection(f); f.y = 0; f.normalize();
      cmd = { mx: f.x * fx + -f.z * fy, mz: f.z * fx + f.x * fy, rot: (k('KeyJ') || k('ArrowLeft') ? 1 : 0) - (k('KeyL') || k('ArrowRight') ? 1 : 0), shoot: k('Space') || this.mouse, intake: true };
      if (cmd.shoot && p.fixedShooter && !cmd.rot && p.fuel > 0) { cmd.heading = p.aimHeading(); cmd.headingGain = 8; }
    }
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 12) { stepWorld(w, STEP, cmd); this.acc -= STEP; n++; }
    if (n === 12) this.acc = 0;
    for (const r of w.robots) r.syncMesh(dt);
    w.fuel.render();
    for (const a of ['red', 'blue']) this.field.hubs[a].ledMat.emissiveIntensity = w.match.hubActive(a) ? 1.8 : 0.05;
    if (this.human) {
      // Driver station view from our alliance wall.
      const s = this.color === 'red' ? 1 : -1;
      const c = new THREE.Vector3(s * (HL + 2.0), 3.0, -s * 1.8), l = new THREE.Vector3(p.x * 0.5 - s * 2.0, 0, p.z * 0.5 - s * 0.6);
      const k = this.camInit ? Math.min(1, dt * 5) : 1;
      this.cam.lerp(c, k); this.look.lerp(l, k); this.camInit = true;
      camera.position.copy(this.cam); camera.lookAt(this.look);
    }
    if (w.match.phase === 'post') this.post += dt;
    return this.post > 3;
  }

  get score() { const m = this.world.match; return [m.total('red'), m.total('blue')]; }
  get clock() {
    const m = this.world.match, t = Math.ceil(m.phase === 'countdown' ? m.countdownEnd - m.t : m.clock);
    return { phase: m.phase === 'teleop' ? m.segment().name : { countdown: '準備', auto: 'AUTO', pause: 'AUTO 結束', post: '比賽結束' }[m.phase] || '', t: `${Math.floor(Math.max(0, t) / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}` };
  }
  get me() { const p = this.world.player; return { fuel: p.fuel, cap: p.p.capacity, scored: p.stats.scored, climb: p.climbLevel }; }
  summary() { return summarize(this.world); }

  dispose() {
    const w = this.world;
    this.scene.remove(w.fuel.mesh);
    w.fuel.mesh.geometry.dispose();
    for (const r of w.robots) { this.scene.remove(r.mesh); if (r.tag) this.scene.remove(r.tag); }
  }
}
