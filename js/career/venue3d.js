import * as THREE from '../three.js';
import { buildField } from '../field.js';
import { HL, HW } from '../config.js';
import { SHIRTS, fmtClock } from './data.js';
import { Place } from './world.js';
import * as K from './machines.js';

// The event venue in first person: the field with its stands, scoring table and queue, the pit
// area with every team's booth (ours has the robot cart), pit admin with inspection, and the exit
// back to the hotel. Also the test site you can use the day before.

const B = 3.05;                // a 10 x 10 ft pit
const AISLE = 2.6;
const PER_SIDE = 12;
const DRAPE_Z = HW + 6.4;      // curtain between the field area and the pits
const PIT_Z0 = DRAPE_Z + 0.4 + B + AISLE / 2;   // first aisle
const GAP = [19.5, 24];        // the way through the curtain, past the end of the pit rows
const ADMIN = { x: 22, z: DRAPE_Z + 1.6 };

function banner(text, color, w = 2.4) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 512, 128);
  x.fillStyle = '#fff'; x.font = 'bold 76px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t }));
}
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const COLORS = [0x1f5fd6, 0xb3262e, 0x2f9e5b, 0x7b4bd1, 0xe07a1f, 0x1b1d22, 0xc9a227, 0x0b7285, 0x8a2f60];

export class Venue extends Place {
  constructor(scene, g, ev) {
    super(scene, g);
    this.ev = ev;
    this.lights();
    this.field = buildField(scene, { stands: false });
    this.arena();
    this.pits();
    const b = this.myBooth;
    this.player = { x: b.x, z: b.z + b.face * 2.2, yaw: b.face > 0 ? 0 : Math.PI, pitch: -0.15 };
    this.bounds = { x0: -32, x1: 32, z0: -11, z1: this.pitEnd + 3 };
    this.makeWip();
    this.sig = {};
  }

  lights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xeef2ff, 0x4a4a52, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(6, 18, 10);
    s.add(sun);
    for (const x of [-7, 0, 7]) { const p = new THREE.PointLight(0xffffff, 22, 22, 1.6); p.position.set(x, 8, 0); s.add(p); }
    for (let z = PIT_Z0; z < PIT_Z0 + 40; z += 9) for (const x of [-16, 0, 16]) { const p = new THREE.PointLight(0xfff2e0, 10, 16, 1.6); p.position.set(x, 6, z); s.add(p); }
  }

  arena() {
    const r = this.root, L = this.ev.venue || 'regional';
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), K.std(0x5d6168, { roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.005, 20);
    r.add(floor);
    // The hall around it all.
    const hall = K.std(0x2a2e36, { roughness: 1 });
    for (const [w, d, x, z] of [[66, 0.4, 0, -14], [66, 0.4, 0, 56], [0.4, 70, -33, 21], [0.4, 70, 33, 21]]) K.box(w, 12, d, hall, x, 6, z, r);
    for (let x = -28; x <= 28; x += 8) for (let z = -8; z <= 50; z += 10) K.box(2.2, 0.08, 0.3, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.2 }), x, 11.5, z, r);
    // The field and its driver stations are off limits.
    this.solid.push({ x0: -HL - 1.3, x1: HL + 1.3, z0: -HW - 0.4, z1: HW + 0.4 });
    // Scoring table.
    K.box(4, 0.75, 0.8, K.std(0x1b1d22), 0, 0.375, HW + 1.5, r);
    K.box(4.02, 0.35, 0.02, K.std(0xf6d31c, { emissive: 0x3a3000 }), 0, 0.45, HW + 1.09, r);
    this.solid.push({ x0: -2, x1: 2, z0: HW + 1.1, z1: HW + 1.9 });
    // Stands on the far side, with a walkway in front of them to watch from.
    const rows = { regional: 7, district: 6, dcmp: 9, champs: 12, einstein: 15 }[L] || 7;
    const seat = K.std(0x3a3f48, { roughness: 0.9 }), spots = [];
    for (let i = 0; i < rows; i++) {
      const y = 0.45 * (i + 1), z = -HW - 3.6 - i * 0.8;
      K.box(26, y, 0.8, seat, 0, y / 2, z, r);
      for (let k = 0; k < 46; k++) if (Math.random() < 0.7) spots.push([-12.6 + k * 0.55 + (Math.random() - 0.5) * 0.1, y + 0.27, z]);
    }
    this.solid.push({ x0: -13, x1: 13, z0: -HW - 3.6 - rows * 0.8, z1: -HW - 3.2 });
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.5, 0.28), K.std(0xffffff, { roughness: 0.8 }), spots.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    spots.forEach(([x, y, z], i) => { crowd.setMatrixAt(i, m.makeTranslation(x, y, z)); crowd.setColorAt(i, col.setHex(SHIRTS[i % SHIRTS.length] ^ (i * 977 & 0x1f1f1f))); });
    r.add(crowd);
    this.crowd = crowd;
    const rail = K.box(26, 1, 0.05, K.std(0x9aa0a8, { metalness: 0.3 }), 0, 0.5, -HW - 0.9, r);
    void rail;
    this.solid.push({ x0: -13, x1: 13, z0: -HW - 0.95, z1: -HW - 0.4 });
    // Big screen over the stands.
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 384;
    this.screenCanvas = c;
    this.screenTex = new THREE.CanvasTexture(c);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    scr.position.set(0, 3 + rows * 0.45 + 1.8, -HW - 4.2 - rows * 0.8);
    r.add(scr);
    // Queue: marshal and a painted area beside the field.
    const q = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.6), K.std(0x2b4a7a, { roughness: 1 }));
    q.rotation.x = -Math.PI / 2; q.position.set(5.5, 0.002, HW + 3.6);
    r.add(q);
    const qs = K.signMesh('QUEUE 排隊區', 1.4);
    qs.position.set(5.5, 2.2, HW + 2.2); r.add(qs);
    this.queueSpot = { x: 5.5, z: HW + 3.6 };
    const marshal = K.person(0xf2c230);
    marshal.group.position.set(8.2, 0, HW + 2.6); marshal.group.rotation.y = -Math.PI / 2;
    r.add(marshal.group);
    this.inter.push({ obj: marshal.group, kind: 'queue', label: '排隊區工作人員' });
    // Robot gates onto the field, one per alliance.
    this.gates = { blue: { x: -HL + 1.6, z: HW + 0.9 }, red: { x: HL - 1.6, z: HW + 0.9 } };
    for (const [a, p] of Object.entries(this.gates)) {
      const gate = K.box(1.4, 1.0, 0.12, K.std(a === 'red' ? 0xb3262e : 0x1f5fd6, { transparent: true, opacity: 0.85 }), p.x, 0.5, p.z - 0.3, r);
      this.inter.push({ obj: gate, kind: 'gate', key: a, label: `${a === 'red' ? '紅' : '藍'}聯盟入場口` });
    }
    // Curtain between the field area and the pits, open in the middle.
    const drape = K.std(0x1c2236, { roughness: 1 });
    for (const [x0, x1] of [[-32, GAP[0]], [GAP[1], 32]]) { K.box(x1 - x0, 2.4, 0.1, drape, (x0 + x1) / 2, 1.2, DRAPE_Z, r); this.solid.push({ x0, x1, z0: DRAPE_Z - 0.05, z1: DRAPE_Z + 0.05 }); }
    const ps = K.signMesh('PITS ↓ · FIELD ↑', 1.4);
    ps.position.set((GAP[0] + GAP[1]) / 2, 2.6, DRAPE_Z); r.add(ps);
    // Pit admin and inspection, just inside the pits.
    K.box(0.8, 0.9, 3, K.std(0xe8eaee), ADMIN.x + 2.5, 0.45, ADMIN.z + 1, r);
    this.solid.push({ x0: ADMIN.x + 2.1, x1: ADMIN.x + 2.9, z0: ADMIN.z - 0.5, z1: ADMIN.z + 2.5 });
    const adm = K.signMesh('PIT ADMIN · 檢錄', 1.6);
    adm.position.set(ADMIN.x + 2.95, 2.1, ADMIN.z + 1); adm.rotation.y = -Math.PI / 2; r.add(adm);
    const admin = K.person(0x22c55e);
    admin.group.position.set(ADMIN.x + 3.3, 0, ADMIN.z + 1); admin.group.rotation.y = -Math.PI / 2;
    r.add(admin.group);
    this.inter.push({ obj: admin.group, kind: 'admin', label: 'Pit Admin（賽程、申請安檢）' });
    const bc = document.createElement('canvas');
    bc.width = 512; bc.height = 512;
    this.boardCanvas = bc;
    this.boardTex = new THREE.CanvasTexture(bc);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: this.boardTex }));
    board.position.set(ADMIN.x + 2.45, 1.6, ADMIN.z - 1.2); board.rotation.y = -Math.PI / 2;
    r.add(board);
    this.inter.push({ obj: board, kind: 'admin', label: '賽程表' });
    this.inspector = K.person(0xff7f2a);
    this.inspector.group.position.set(ADMIN.x + 3.3, 0, ADMIN.z + 2);
    r.add(this.inspector.group);
  }

  // Every team's booth, in rows back to back along aisles. Ours gets the real robot and gear.
  pits() {
    const r = this.root, nums = this.ev.teams.map((t) => t.number).sort((a, b) => a - b);
    const per = PER_SIDE * 2, aisles = Math.ceil(nums.length / per);
    const meIdx = nums.indexOf(this.g.team.number);
    const carpet = K.std(0x30343c, { roughness: 1 }), drapeM = K.std(0x232a40, { roughness: 1 }), table = K.std(0x8a6a45);
    const n = nums.length;
    const floorI = new THREE.InstancedMesh(new THREE.PlaneGeometry(B - 0.05, B - 0.05), carpet, n);
    const backI = new THREE.InstancedMesh(new THREE.BoxGeometry(B, 2.4, 0.05), drapeM, n);
    const sideI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, B), drapeM, n * 2);
    const tableI = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.85, 0.6), table, n);
    const botI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.45, 0.75), K.std(0x8c939c, { metalness: 0.2 }), n);
    const bumpI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.13, 0.9), K.std(0xffffff, { roughness: 0.8 }), n);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color(), one = new THREE.Vector3(1, 1, 1);
    const place = (mesh, i, x, y, z, ry, rx = 0) => { e.set(rx, ry, 0); q.setFromEuler(e); mt.compose(new THREE.Vector3(x, y, z), q, one); mesh.setMatrixAt(i, mt); };
    this.booths = [];
    nums.forEach((num, i) => {
      const a = Math.floor(i / per), k = i % per, side = k < PER_SIDE ? -1 : 1, c = k % PER_SIDE;
      const az = PIT_Z0 + a * (AISLE + 2 * B);
      const x = (c - (PER_SIDE - 1) / 2) * B, z = az + side * (AISLE / 2 + B / 2), face = -side;   // open toward the aisle
      place(floorI, i, x, 0.003, z, 0, -Math.PI / 2);
      place(backI, i, x, 1.2, z - face * B / 2, 0);
      place(sideI, 2 * i, x - B / 2, 0.5, z, 0); place(sideI, 2 * i + 1, x + B / 2, 0.5, z, 0);
      place(tableI, i, x - 0.6, 0.42, z - face * (B / 2 - 0.4), 0);
      const mine = num === this.g.team.number;
      place(botI, i, mine ? 0 : x + 0.6, mine ? -9 : 0.75, z, 0.3);
      place(bumpI, i, mine ? 0 : x + 0.6, mine ? -9 : 0.6, z, 0.3);
      bumpI.setColorAt(i, col.setHex(i % 2 ? 0xb3262e : 0x1f5fd6));
      const bn = banner(String(num), mine ? '#f2a51a' : hex(COLORS[num % COLORS.length]), 2.4);
      bn.position.set(x, 2.1, z - face * (B / 2 - 0.04));
      bn.rotation.y = face > 0 ? 0 : Math.PI;
      r.add(bn);
      this.solid.push({ x0: x - B / 2, x1: x + B / 2, z0: z - face * B / 2 - 0.05, z1: z - face * B / 2 + 0.05 });
      this.booths.push({ num, x, z, face, aisle: az });
      if (mine) this.myBooth = { x, z, face, aisle: az };
    });
    for (const m of [floorI, backI, sideI, tableI, botI, bumpI]) { m.instanceMatrix.needsUpdate = true; r.add(m); }
    if (bumpI.instanceColor) bumpI.instanceColor.needsUpdate = true;
    this.pitEnd = PIT_Z0 + (aisles - 1) * (AISLE + 2 * B) + AISLE / 2 + B + 1;
    // Our gear: robot cart, battery cart, toolbox.
    const b = this.myBooth ?? { x: 0, z: PIT_Z0 + 3, face: -1, aisle: PIT_Z0 };
    this.myBooth = b;
    this.cartM = K.cart();
    this.cartHome = { x: b.x + 0.4, z: b.z + b.face * 0.15 };
    this.cartM.group.position.set(this.cartHome.x, 0, this.cartHome.z);
    r.add(this.cartM.group);
    this.inter.push({ obj: this.cartM.group, kind: 'robot', label: '我們的機器人' });
    const batt = new THREE.Group();
    K.box(0.55, 0.7, 0.4, K.MAT.grey, 0, 0.35, 0, batt);
    for (let i = 0; i < 3; i++) K.box(0.16, 0.17, 0.18, K.MAT.black, -0.18 + i * 0.18, 0.79, 0, batt);
    batt.position.set(b.x - 1.1, 0, b.z + b.face * 0.9);
    r.add(batt);
    this.inter.push({ obj: batt, kind: 'battery', label: '電池與充電器' });
    const tb = K.box(0.7, 0.95, 0.45, K.MAT.red, b.x + 1.1, 0.48, b.z - b.face * (B / 2 - 0.35), r);
    this.inter.push({ obj: tb, kind: 'pitcrew', label: 'Pit 白板（隊員分工）' });
    // The way out.
    const door = K.box(0.1, 2.3, 1.6, K.std(0x6b7a8f), -31.9, 1.15, PIT_Z0, r);
    const ds = K.signMesh('出口 → 回飯店', 1.1);
    ds.position.set(-31.8, 2.6, PIT_Z0); ds.rotation.y = Math.PI / 2; r.add(ds);
    this.inter.push({ obj: door, kind: 'leave', label: '離開賽場（回飯店，結束今天）' });
  }

  get entry() { return { x: -30, z: PIT_Z0 }; }
  inStands(p = this.player) { return p.z < -HW - 0.9 && Math.abs(p.x) < 13; }
  get adminSpot() { return ADMIN; }
  near(p, q, r = 1.6) { return Math.hypot(p.x - q.x, p.z - q.z) < r; }

  // Crew: pit crew in the booth, scouts in the stands, the runner with the robot.
  stationFor(c) { return this.g.evRoles?.[c.id] || 'pit'; }
  standPoint(st, idx) {
    const b = this.myBooth;
    if (st === 'scout') return { x: -6 + idx * 0.8, z: -HW - 2.2, face: Math.PI };
    if (st === 'runner' && ['queue', 'carried'].includes(this.g.robotPos)) return { x: this.queueSpot.x - 1, z: this.queueSpot.z, face: 0 };
    if (st === 'drive' && this.g.robotPos === 'field') return { x: -HL - 0.6, z: -1 + idx * 0.6, face: -Math.PI / 2 };
    return { x: b.x - 0.8 + (idx % 3) * 0.7, z: b.z + b.face * (0.6 + Math.floor(idx / 3) * 0.6), face: b.face > 0 ? Math.PI : 0 };
  }
  route(p, t) {
    const az = (z) => { let best = PIT_Z0; for (let a = PIT_Z0; a < this.pitEnd; a += AISLE + 2 * B) if (Math.abs(z - a) < Math.abs(z - best)) best = a; return best; };
    const inPits = (z) => z > DRAPE_Z, gx = (GAP[0] + GAP[1]) / 2;
    if (inPits(p.z) && inPits(t.z)) return [{ x: p.x, z: az(p.z) }, { x: t.x, z: az(p.z) }, { x: t.x, z: az(t.z) }, { x: t.x, z: t.z }];
    const pts = [];
    if (inPits(p.z)) pts.push({ x: p.x, z: az(p.z) }, { x: gx, z: az(p.z) }, { x: gx, z: HW + 5 });
    if (t.z < -HW) pts.push({ x: 11, z: inPits(p.z) ? HW + 5 : p.z }, { x: 11, z: -HW - 2 });
    if (inPits(t.z)) pts.push({ x: gx, z: HW + 5 }, { x: gx, z: az(t.z) }, { x: t.x, z: az(t.z) });
    pts.push({ x: t.x, z: t.z });
    return pts;
  }

  // Where the robot cart is: in our pit, in front of you, in the queue, or gone (on the field).
  placeCart() {
    const g = this.g, c = this.cartM.group, p = this.player;
    c.visible = g.robotPos !== 'field' && !g.robotAway;
    if (g.robotPos === 'pit') { c.position.set(this.cartHome.x, 0, this.cartHome.z); c.rotation.y = 0; }
    else if (g.robotPos === 'queue') { c.position.set(this.queueSpot.x, 0, this.queueSpot.z); c.rotation.y = 0; }
    else if (g.robotPos === 'gate') { const gt = this.gates[g.matchColor || 'blue']; c.position.set(gt.x, 0, gt.z + 0.9); }
    else if (g.robotPos === 'carried') {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      c.position.set(p.x + fx * 1.05, 0, p.z + fz * 1.05);
      c.rotation.y = p.yaw;
    }
  }
  // Pushing the cart: it has to fit through too.
  walk(dt, f, s, run) {
    if (this.g.robotPos !== 'carried') return super.walk(dt, f, s, run);
    const p = this.player, x0 = p.x, z0 = p.z;
    super.walk(dt * 0.65, f, s, false);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), cx = p.x + fx * 1.05, cz = p.z + fz * 1.05;
    const [ax, az] = this.collide(cx, cz);
    if (Math.hypot(ax - cx, az - cz) > 0.01) { p.x = x0; p.z = z0; }
  }

  sync() {
    if (this.g.rev !== this.sig.rev) { this.sig.rev = this.g.rev; this.makeWip(); }
    this.showRobot(this.ghost ?? null);
    this.placeCart();
  }

  drawScreens(info) {
    const x = this.screenCanvas.getContext('2d');
    x.fillStyle = '#0b0f1a'; x.fillRect(0, 0, 1024, 384);
    x.fillStyle = '#f6d31c'; x.fillRect(0, 366, 1024, 18);
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = 'bold 50px system-ui';
    x.fillText(this.ev.title.slice(0, 34), 512, 90);
    x.font = '44px system-ui'; x.fillStyle = '#9fb3d9';
    x.fillText(info?.screen || 'REBUILT · 2026', 512, 190);
    if (info?.score) { x.font = 'bold 80px system-ui'; x.fillStyle = '#ff6b6b'; x.fillText(info.score[0], 340, 310); x.fillStyle = '#6ba3ff'; x.fillText(info.score[1], 684, 310); }
    this.screenTex.needsUpdate = true;
    const b = this.boardCanvas.getContext('2d');
    b.fillStyle = '#f4f4f0'; b.fillRect(0, 0, 512, 512);
    b.fillStyle = '#1b4fbf'; b.font = 'bold 30px system-ui'; b.textAlign = 'left';
    b.fillText('我們的場次', 20, 44);
    b.font = '22px system-ui'; b.fillStyle = '#222';
    (info?.mine || []).slice(0, 14).forEach((m, i) => b.fillText(`${m.id}  ${fmtClock(m.t)}  ${m.note || ''}`, 20, 84 + i * 30));
    this.boardTex.needsUpdate = true;
  }

  animate(t) {
    const u = this.inspector.group;
    if (this.g.insp?.state === 'coming' || this.g.insp?.state === 'here') {
      const b = this.myBooth, tx = b.x - 1.2, tz = b.z + b.face * 1.6;
      u.position.x += (tx - u.position.x) * 0.02; u.position.z += (tz - u.position.z) * 0.02;
    } else { u.position.x += (ADMIN.x + 3.3 - u.position.x) * 0.02; u.position.z += (ADMIN.z + 2 - u.position.z) * 0.02; }
    void t;
  }
}

// The day before the event: a borrowed practice space (a local team's field, or a hotel ballroom).
export class TestSite extends Place {
  constructor(scene, g, kind) {
    super(scene, g);
    this.kind = kind;
    const s = scene;
    s.add(new THREE.HemisphereLight(0xf4f6ff, 0x5a5550, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(4, 8, 6); s.add(sun);
    const W = 16, D = 12, r = this.root;
    this.bounds = { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), K.std(kind === 'team' ? 0x4d5560 : 0x7a3b3b, { roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    r.add(floor);
    if (kind === 'team') {
      const carpet = new THREE.Mesh(new THREE.PlaneGeometry(10, 7), K.std(0x55606b, { roughness: 1 }));
      carpet.rotation.x = -Math.PI / 2; carpet.position.set(1.5, 0.003, -1.5); r.add(carpet);
    } else {
      for (let i = 0; i < 6; i++) K.box(1.6, 0.75, 1.6, K.std(0xe8e1d0), -5 + (i % 3) * 2.2, 0.38, 3.5 + Math.floor(i / 3) * 1.6, r);
    }
    const wall = K.std(kind === 'team' ? 0xd0d3d6 : 0xd9c9a8, { roughness: 0.95 });
    for (const [w, d, x, z] of [[W, 0.2, 0, -D / 2], [W, 0.2, 0, D / 2], [0.2, D, -W / 2, 0], [0.2, D, W / 2, 0]]) K.box(w, 3, d, wall, x, 1.5, z, r);
    const sign = K.signMesh(kind === 'team' ? '當地隊伍的練習場' : '飯店宴會廳', 1.6);
    sign.position.set(0, 2.5, -D / 2 + 0.12); r.add(sign);
    this.cartM = K.cart();
    this.cartM.group.position.set(-4.5, 0, -2);
    r.add(this.cartM.group);
    this.inter.push({ obj: this.cartM.group, kind: 'robot', label: '我們的機器人' });
    const drive = K.box(0.06, 2.2, 1.4, K.std(0x2f9e5b), W / 2 - 0.1, 1.1, 0, r);
    this.inter.push({ obj: drive, kind: 'testdrive', label: '開到場上測試' });
    const go = K.box(0.06, 2.2, 1.4, K.std(0x6b7a8f), -W / 2 + 0.1, 1.1, 3.5, r);
    this.inter.push({ obj: go, kind: 'loadin', label: '收拾，前往賽場 load-in' });
    this.player = { x: -2.5, z: 0.5, yaw: Math.PI / 2 + 0.4, pitch: -0.2 };
    this.makeWip();
  }
  get entry() { return { x: -6, z: 3.5 }; }
  stationFor() { return 'pit'; }
  standPoint(st, idx) { return { x: -5.6 + (idx % 3) * 0.6, z: -0.8 + Math.floor(idx / 3) * 0.6, face: Math.PI }; }
  route(p, t) { return [{ x: t.x, z: t.z }]; }
  sync() { this.showRobot(this.ghost ?? null); this.cartM.group.visible = !this.g.robotAway; }
  drawScreens() {}
  animate() {}
}
