import * as THREE from '../three.js';
import { buildField, inZone } from '../field.js';
import { createWorld, stepWorld } from '../sim.js';
import { HL } from '../config.js';
import { robotBuild } from './state.js';

// The practice field: drive the robot as built (missing mechanisms don't work) on a full field.
// Game time keeps running; every minute driven counts as driver practice.

const STEP = 1 / 120;

export class Practice {
  constructor(renderer, g, build = robotBuild(g)) {
    this.renderer = renderer;
    this.g = g;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0e1116);
    s.add(new THREE.HemisphereLight(0xdfe8ff, 0x30333a, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 14, 6);
    s.add(sun);
    for (const x of [-6, 0, 6]) { const p = new THREE.PointLight(0xffffff, 18, 18, 1.6); p.position.set(x, 7, 0); s.add(p); }
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 120);
    this.field = buildField(s);
    const b = build;
    this.world = createWorld(s, this.field, { mode: 'practice', alliance: 'blue', preset: 'custom-career', team: g.team.number, customs: [{ ...b, id: 'career' }] });
    this.world.player.fuel = Math.min(this.world.player.fuel, this.world.player.p.capacity);
    this.acc = 0;
    this.keys = new Set();
    this.mouse = false;
    this.cam = new THREE.Vector3(-(HL + 2), 3, 1.8);
    this.look = new THREE.Vector3();
  }

  key(code, down) { if (down) this.keys.add(code); else this.keys.delete(code); if (down && code === 'KeyC') this.world.player.requestClimb(this.world); if (down && code === 'KeyX') this.world.player.descend(); }

  update(dt) {
    const k = (c) => this.keys.has(c), p = this.world.player;
    // Driver-station view: forward = away from our wall (+x), left = -z... screen-relative.
    const fx = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0), fy = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f); f.y = 0; f.normalize();
    const cmd = {
      mx: f.x * fx + -f.z * fy, mz: f.z * fx + f.x * fy,
      rot: (k('KeyJ') || k('ArrowLeft') ? 1 : 0) - (k('KeyL') || k('ArrowRight') ? 1 : 0),
      shoot: k('Space') || this.mouse, intake: true,
    };
    if (cmd.shoot && p.fixedShooter && !cmd.rot && p.fuel > 0) { cmd.heading = p.aimHeading(); cmd.headingGain = 8; }
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 12) { stepWorld(this.world, STEP, cmd); this.acc -= STEP; n++; }
    if (n === 12) this.acc = 0;
    for (const r of this.world.robots) r.syncMesh(dt);
    this.world.fuel.render();
    const c = new THREE.Vector3(-(HL + 2.0), 3.0, 1.8), l = new THREE.Vector3(p.x * 0.5 + 2.0, 0, p.z * 0.5 + 0.6);
    this.cam.lerp(c, Math.min(1, dt * 5)); this.look.lerp(l, Math.min(1, dt * 5));
    this.camera.position.copy(this.cam);
    this.camera.lookAt(this.look);
    return { fuel: p.fuel, cap: p.p.capacity, scored: p.stats.scored, shots: p.stats.shots, inZone: inZone('blue', p.x), climb: p.climbLevel };
  }

  render() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}
