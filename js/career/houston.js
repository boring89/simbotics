import * as THREE from '../three.js';
import { HL, HW } from '../config.js';
import { SHIRTS } from './data.js';
import { season } from '../season.js';
import { Venue } from './venue3d.js';
import * as K from './machines.js';

// The FIRST Championship in Houston, laid out after FIRST's published 2026 floor plans of the
// George R. Brown Convention Center's first floor: Hall A (west) and Hall E (east) hold the pits
// of four divisions each, with practice fields along the outer walls; the eight division fields
// stand in a row through Halls B–D with bleachers on both sides and curtains between them; the
// Robot Service Center is at the back of Hall C; the concourse with the FIRST Store runs along
// the south side. On Einstein day the Galileo and Johnson fields become MASS and ENERGY with the
// stage between them. Distances follow the floor plan; the ceiling is about three storeys up.

const S = 0.243;                       // metres per pixel of the floor plan (fits a field to its box)
const MAP_Y = 330;                     // field centre line on the plan
const DIVS = ['arc', 'cur', 'dal', 'gal', 'hop', 'joh', 'mil', 'new'];
const NAME = { arc: 'Archimedes', cur: 'Curie', dal: 'Daly', gal: 'Galileo', hop: 'Hopper', joh: 'Johnson', mil: 'Milstein', new: 'Newton' };
const FIELD_PX = { arc: 340, cur: 436, dal: 527, gal: 621, hop: 713, joh: 806, mil: 898, new: 991 };
const AIR_PX = [290, 1045];            // air walls between the pit halls and Halls B–D
// Pit quadrants: Hall A has Archimedes (NW), Daly (NE), Curie (SW), Galileo (SE); Hall E has
// Hopper (NW), Milstein (NE), Johnson (SW), Newton (SE).
const QUAD = { arc: [0, 0, 0], dal: [0, 1, 0], cur: [0, 0, 1], gal: [0, 1, 1], hop: [1, 0, 0], mil: [1, 1, 0], joh: [1, 0, 1], new: [1, 1, 1] };
const B = 3.05, STREET = 2.4, PAIR = 2 * B + STREET, PAIRS = 5, ROWS = 8;   // room for 80 teams per division
const CEIL = 11;
const NORTH_ROWS = 14, SOUTH_ROWS = 19, SEAT = 0.8, BLEACH_IN = HW + 2.2, BLEACH_HALF = 9.4;
const BAY = HL + 2.1;                  // the gap between a field's end and the curtain, where robots go on
const NORTH_WALL = -41, SOUTH_WALL = 34, CONCOURSE = 51, CORRIDOR = BLEACH_IN + SOUTH_ROWS * SEAT + 2.2;
const AISLE_Z = SOUTH_WALL - 3.5;      // the east–west aisle along the south side of every hall

function signTex(text, w = 1024, h = 192, bg = '#0b0f1a', fg = '#ffffff', font = 'bold 120px system-ui') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const plane = (tex, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));

export class Houston extends Venue {
  // Venue's constructor calls lights(), arena() and pits(); those are ours below.
  constructor(scene, g, ev) {
    super(scene, g, ev);
    this.timeScale = 1 / 3;   // a huge hall: 1 s = 20 s here, so walking to the field doesn't eat the schedule
    const f = this.boothFront;
    this.player = { x: f.x, z: f.z, yaw: f.yaw, pitch: -0.15 };
    this.bounds = { x0: this.west + 0.5, x1: this.east - 0.5, z0: NORTH_WALL + 0.5, z1: CONCOURSE - 0.5 };
  }

  // Which division (and so which field and pit block) is ours.
  setup() {
    if (this.div) return;
    const key = this.ev.key || '';
    this.einstein = this.ev.venue === 'einstein';
    const prev = this.g.history?.[this.g.history.length - 1]?.key || '';
    this.div = this.einstein ? DIVS.find((d) => prev.endsWith(d)) || 'gal' : DIVS.find((d) => key.endsWith(d)) || 'gal';
    // Our field sits at the origin (the match physics run there).
    this.fx0 = this.einstein ? FIELD_PX.gal : FIELD_PX[this.div];
    this.X = (px) => (px - this.fx0) * S;
    this.Z = (py) => (py - MAP_Y) * S;
    this.airA = this.X(AIR_PX[0]); this.airE = this.X(AIR_PX[1]);
    const hall = 6 + 2 * (PAIRS * PAIR + 2) + 12;
    this.west = this.airA - hall - 2; this.east = this.airE + hall + 2;
  }

  lights() {
    this.setup();
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xf2f4ff, 0x4a4a52, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(20, 30, 10);
    s.add(sun);
    for (const x of [-8, 0, 8]) { const p = new THREE.PointLight(0xffffff, 30, 30, 1.5); p.position.set(x, 9, 0); s.add(p); }
  }

  arena() {
    this.setup();
    const r = this.root, X = this.X, Z = this.Z;
    const W = this.east - this.west, cx = (this.west + this.east) / 2;
    // Floor, walls and the ceiling about three storeys up.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, CONCOURSE - NORTH_WALL), K.std(0x6a6e74, { roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, -0.005, (NORTH_WALL + CONCOURSE) / 2);
    r.add(floor);
    const wall = K.std(0x3a3f48, { roughness: 1 });
    const solidBox = (w, h, d, x, y, z, mat = wall) => { K.box(w, h, d, mat, x, y, z, r); this.solid.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }); };
    solidBox(W, CEIL, 0.4, cx, CEIL / 2, NORTH_WALL);
    solidBox(W, CEIL, 0.4, cx, CEIL / 2, CONCOURSE);
    solidBox(0.4, CEIL, CONCOURSE - NORTH_WALL, this.west, CEIL / 2, (NORTH_WALL + CONCOURSE) / 2);
    solidBox(0.4, CEIL, CONCOURSE - NORTH_WALL, this.east, CEIL / 2, (NORTH_WALL + CONCOURSE) / 2);
    // The south wall of the halls, with doors out to the concourse.
    const doors = [X(205), X(665), X(1130)].sort((a, b) => a - b);
    let x0 = this.west;
    for (const d of [...doors, this.east + 2.5]) { const x1 = Math.min(d - 2.5, this.east); if (x1 > x0) solidBox(x1 - x0, CEIL, 0.3, (x0 + x1) / 2, CEIL / 2, SOUTH_WALL); x0 = d + 2.5; }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, CONCOURSE - NORTH_WALL), K.std(0x2b2f36, { roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, CEIL, (NORTH_WALL + CONCOURSE) / 2);
    r.add(ceil);
    const fix = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.3 }), 2000);
    let n = 0;
    const m = new THREE.Matrix4();
    for (let x = this.west + 4; x < this.east - 2 && n < 2000; x += 9) for (let z = NORTH_WALL + 4; z < SOUTH_WALL - 2 && n < 2000; z += 9) fix.setMatrixAt(n++, m.makeTranslation(x, CEIL - 0.1, z));
    fix.count = n;
    r.add(fix);
    // Air walls: open in the middle where the pit halls meet the field halls; Pit Admin beside them.
    for (const ax of [this.airA, this.airE]) {
      solidBox(0.4, CEIL, 18, ax, CEIL / 2, NORTH_WALL + 9, K.std(0x555b66));
      solidBox(0.4, CEIL, 1.5, ax, CEIL / 2, SOUTH_WALL - 0.75, K.std(0x555b66));
    }
    const adminX = this.div && QUAD[this.div][0] === 0 ? this.airA - 2.5 : this.airE + 2.5;
    this.admin = { x: adminX, z: Z(318) };
    K.box(0.8, 0.9, 3, K.std(0xe8eaee), adminX, 0.45, this.admin.z, r);
    this.solid.push({ x0: adminX - 0.4, x1: adminX + 0.4, z0: this.admin.z - 1.5, z1: this.admin.z + 1.5 });
    const as = K.signMesh('PIT ADMIN · 檢錄', 1.6);
    as.position.set(adminX, 2.2, this.admin.z); as.rotation.y = QUAD[this.div][0] === 0 ? -Math.PI / 2 : Math.PI / 2; r.add(as);
    const adminP = K.person(0x22c55e);
    const side = QUAD[this.div][0] === 0 ? 1 : -1;   // the desk faces our pits
    adminP.group.position.set(adminX - side * 0.8, 0, this.admin.z); adminP.group.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    r.add(adminP.group);
    this.inter.push({ obj: adminP.group, kind: 'admin', label: 'Pit Admin（賽程、申請安檢）' });
    const bc = document.createElement('canvas');
    bc.width = 512; bc.height = 512;
    this.boardCanvas = bc;
    this.boardTex = new THREE.CanvasTexture(bc);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: this.boardTex }));
    board.position.set(adminX - side * 0.42, 1.6, this.admin.z + 2.2); board.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    r.add(board);
    this.inter.push({ obj: board, kind: 'admin', label: '賽程表' });
    this.inspector = K.person(0xff7f2a);
    this.inspector.group.position.set(adminX - side * 1.4, 0, this.admin.z + 1.5);
    r.add(this.inspector.group);
    this.fields();
    this.halls();
    this.concourse();
  }

  // The eight division fields (or MASS, the stage and ENERGY on Einstein day).
  fields() {
    const r = this.root, X = this.X;
    const crowdSpots = [];
    const seat = K.std(0x3a3f48, { roughness: 0.9 }), rail = K.std(0x9aa0a8, { metalness: 0.3 });
    const list = this.einstein ? ['gal', 'hop', 'joh'] : DIVS;
    for (const d of list) {
      const x = X(FIELD_PX[d]), ours = x === 0;
      const stage = this.einstein && d === 'hop';
      if (stage) {
        K.box(12, 1.2, 6, K.std(0xb3262e), x, 0.6, 0, r);
        this.solid.push({ x0: x - 6, x1: x + 6, z0: -3, z1: 3 });
        const st = plane(signTex('STAGE', 512, 128, '#7a1018'), 4, 1); st.position.set(x, 3, -3.1); r.add(st);
      } else if (!ours) this.mockField(x, d);
      // Bleachers on both sides, stepping up away from the field.
      for (const [sgn, rows] of [[-1, NORTH_ROWS], [1, SOUTH_ROWS]]) {
        for (let i = 0; i < rows; i++) {
          const y = 0.45 * (i + 1), z = sgn * (BLEACH_IN + i * SEAT + SEAT / 2);
          K.box(BLEACH_HALF * 2, y, SEAT, seat, x, y / 2, z, r);
          for (let k = 0; k < 33; k++) if (Math.random() < 0.65) crowdSpots.push([x - BLEACH_HALF + 0.3 + k * 0.56, y + 0.27, z]);
        }
        const z0 = BLEACH_IN, z1 = BLEACH_IN + rows * SEAT;
        this.solid.push({ x0: x - BLEACH_HALF, x1: x + BLEACH_HALF, z0: sgn > 0 ? z0 : -z1, z1: sgn > 0 ? z1 : -z0 });
        K.box(BLEACH_HALF * 2, 1, 0.05, rail, x, 0.5, sgn * (HW + 0.45), r);
      }
      if (!stage) {
        this.solid.push({ x0: x - HL - 1.3, x1: x + HL + 1.3, z0: -HW - 0.4, z1: HW + 0.4 });
        // Division sign hanging over the field.
        const label = this.einstein ? (d === 'gal' ? 'MASS' : 'ENERGY') : NAME[d].toUpperCase();
        const sg = plane(signTex(label, 1024, 192, ours ? '#1b4fbf' : '#0b0f1a'), 10, 1.9);
        sg.position.set(x, 8.6, 0); r.add(sg);
      }
    }
    // Curtains between the division bays (not on Einstein day, which is one open arena).
    if (!this.einstein) {
      const drape = K.std(0x7a1a1a, { roughness: 1 });
      for (let i = 0; i < DIVS.length - 1; i++) {
        const x = (X(FIELD_PX[DIVS[i]]) + X(FIELD_PX[DIVS[i + 1]])) / 2;
        const zn = -(BLEACH_IN + NORTH_ROWS * SEAT), zs = CORRIDOR - 2;
        K.box(0.12, 6, zs - zn, drape, x, 3, (zs + zn) / 2, r);
        this.solid.push({ x0: x - 0.08, x1: x + 0.08, z0: zn, z1: zs });
      }
    }
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.5, 0.28), K.std(0xffffff, { roughness: 0.8 }), crowdSpots.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    crowdSpots.forEach(([x, y, z], i) => { crowd.setMatrixAt(i, m.makeTranslation(x, y, z)); crowd.setColorAt(i, col.setHex(SHIRTS[i % SHIRTS.length] ^ (i * 977 & 0x1f1f1f))); });
    r.add(crowd);
    // Our big screen, over the far bleachers.
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 384;
    this.screenCanvas = c;
    this.screenTex = new THREE.CanvasTexture(c);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    scr.position.set(0, 9.5, -(BLEACH_IN + NORTH_ROWS * SEAT) + 0.3);
    r.add(scr);
    // Queue in the corridor behind our south bleachers; robots go on at either end of the field.
    this.queueSpot = { x: 4, z: CORRIDOR };
    const q = new THREE.Mesh(new THREE.PlaneGeometry(9, 3), K.std(0x2b4a7a, { roughness: 1 }));
    q.rotation.x = -Math.PI / 2; q.position.set(this.queueSpot.x, 0.004, this.queueSpot.z); r.add(q);
    const qs = K.signMesh('QUEUE 排隊區', 1.4); qs.position.set(this.queueSpot.x, 2.4, CORRIDOR - 1.6); r.add(qs);
    const marshal = K.person(0xf2c230);
    marshal.group.position.set(this.queueSpot.x + 4.6, 0, CORRIDOR); marshal.group.rotation.y = -Math.PI / 2;
    r.add(marshal.group);
    this.inter.push({ obj: marshal.group, kind: 'queue', label: '排隊區工作人員' });
    this.gates = { blue: { x: -HL - 1.0, z: HW + 0.9 }, red: { x: HL + 1.0, z: HW + 0.9 } };
    for (const [a, p] of Object.entries(this.gates)) {
      const gate = K.box(0.12, 1.0, 1.2, K.std(a === 'red' ? 0xb3262e : 0x1f5fd6, { transparent: true, opacity: 0.85 }), p.x, 0.5, p.z, r);
      this.inter.push({ obj: gate, kind: 'gate', key: a, label: `${a === 'red' ? '紅' : '藍'}聯盟入場口` });
    }
    // Saturday: the playoff alliance pits behind the north bleachers (A1–A8 for Archimedes...).
    this.alliancePits = new THREE.Group();
    r.add(this.alliancePits);
    if (!this.einstein) {
      for (const d of DIVS) {
        const x = X(FIELD_PX[d]), z = -(BLEACH_IN + NORTH_ROWS * SEAT) - 2.6;
        for (let i = 0; i < 8; i++) {
          const bx = x - 8.4 + i * 2.4;
          K.box(2.2, 0.02, 2.2, K.std(0x2f9e5b, { roughness: 1 }), bx, 0.01, z, this.alliancePits);
          const t = plane(signTex(`${NAME[d][0]}${i + 1}`, 256, 128, '#1f6f3f', '#fff', 'bold 90px system-ui'), 1.2, 0.6);
          t.position.set(bx, 1.6, z - 1.0); this.alliancePits.add(t);
        }
      }
    }
    // Robot Service Center (machine shop, spare parts) at the back of Hall C, and the ship desk.
    const shop = K.std(0xe0a060);
    for (let i = 0; i < 7; i++) K.box(3.2, 0.9, 1.4, shop, X(545) + i * 4.2, 0.45, this.Z(232), r);
    const rs = plane(signTex('ROBOT SERVICE CENTER', 1024, 128, '#3a2a10', '#ffd9a0', 'bold 70px system-ui'), 8, 1); rs.position.set(X(667), 4, this.Z(228)); r.add(rs);
    K.box(2.4, 1.1, 1.6, K.std(0xe8b080), X(905), 0.55, this.Z(182), r);
    const sd = K.signMesh('SHIP DESK', 1.2); sd.position.set(X(905), 2, this.Z(182) + 0.9); r.add(sd);
  }

  // A division field we only look at: carpet, alliance walls, HUBs and towers.
  mockField(x, d) {
    const r = this.root;
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2 * HL, 2 * HW), K.std(0x4b5058, { roughness: 1 }));
    carpet.rotation.x = -Math.PI / 2; carpet.position.set(x, 0.003, 0); r.add(carpet);
    for (const [s, col] of [[-1, 0x1f5fd6], [1, 0xb3262e]]) {
      K.box(0.2, 2, 2 * HW, K.std(col), x + s * HL, 1, 0, r);
      const hub = K.box(1.2, 1.8, 1.2, K.std(0x1e8a8a), x + s * 3.65, 0.9, 0, r);
      void hub;
      K.box(0.1, 1.8, 1.1, K.std(0x9aa0a8, { metalness: 0.3 }), x + s * (HL - 1.06), 0.9, -s * 0.3, r);
    }
    for (const z of [-HW, HW]) K.box(2 * HL, 0.5, 0.05, K.std(0xcfe0ff, { transparent: true, opacity: 0.3 }), x, 0.25, z, r);
    void d;
  }

  // Hall A and Hall E: pits for four divisions each, with practice fields along the outer wall.
  halls() {
    const r = this.root;
    for (const hall of [0, 1]) {
      const air = hall === 0 ? this.airA : this.airE, dir = hall === 0 ? -1 : 1;
      const label = plane(signTex(hall === 0 ? 'HALL A' : 'HALL E', 512, 128), 6, 1.5);
      label.position.set(air + dir * 30, 9, NORTH_WALL + 0.3); r.add(label);
      // Practice fields and the test area along the outer wall.
      const px = air + dir * (6 + 2 * (PAIRS * PAIR + 2) + 6);
      for (const z of [-16, 16]) {
        const pf = new THREE.Mesh(new THREE.PlaneGeometry(9, 17), K.std(0x45505c, { roughness: 1 }));
        pf.rotation.x = -Math.PI / 2; pf.position.set(px, 0.004, z); r.add(pf);
        const ps = plane(signTex('PRACTICE', 512, 128, '#1b4fbf'), 3, 0.75); ps.position.set(px, 3, z); ps.rotation.y = Math.PI / 2; r.add(ps);
      }
      const ta = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), K.std(0x8a6a45, { roughness: 1 }));
      ta.rotation.x = -Math.PI / 2; ta.position.set(px, 0.005, SOUTH_WALL - 3); r.add(ta);
      const ts = K.signMesh('TEST AREA', 1.2); ts.position.set(px, 2, SOUTH_WALL - 1.2); r.add(ts);
      const tsc = K.signMesh('Team Service Center', 1.4); tsc.position.set(air + dir * 40, 2.2, NORTH_WALL + 1); r.add(tsc);
    }
  }

  concourse() {
    const r = this.root, X = this.X;
    const store = K.box(X(642) - X(437), 3, 5, K.std(0xd04fbf), (X(437) + X(642)) / 2, 1.5, SOUTH_WALL + 4, r);
    this.solid.push({ x0: X(437), x1: X(642), z0: SOUTH_WALL + 1.5, z1: SOUTH_WALL + 6.5 });
    const ss = plane(signTex('FIRST STORE', 1024, 192, '#9c2a8c'), 8, 1.5); ss.position.set((X(437) + X(642)) / 2, 3.6, SOUTH_WALL + 1.45); ss.rotation.y = Math.PI; r.add(ss);
    void store;
    const reg = K.box(6, 1, 1.4, K.std(0xd04fbf), X(667), 0.5, CONCOURSE - 4, r);
    void reg;
    const rs = K.signMesh('Registration', 1.4); rs.position.set(X(667), 2, CONCOURSE - 4.8); r.add(rs);
    const door = K.box(2.4, 2.4, 0.1, K.std(0x6b7a8f), X(500), 1.2, CONCOURSE - 0.25, r);
    const ds = K.signMesh('出口 → 回飯店', 1.1); ds.position.set(X(500), 2.8, CONCOURSE - 0.35); ds.rotation.y = Math.PI; r.add(ds);
    this.inter.push({ obj: door, kind: 'leave', label: '離開會場（回飯店，結束今天）' });
    const cs = plane(signTex('GEORGE R. BROWN CONVENTION CENTER · CONCOURSE', 2048, 160, '#14213d', '#f6d31c', 'bold 80px system-ui'), 24, 1.9);
    cs.position.set(X(667), 6, CONCOURSE - 0.3); cs.rotation.y = Math.PI; r.add(cs);
  }

  // Every division's pits in its block. Booths open onto the north–south streets.
  pits() {
    this.setup();
    const r = this.root, champs = this.ev.venue !== 'einstein';
    const divTeams = (d) => {
      const e = season()?.events.find((x) => x.key === `2026${d}`);
      return e ? [...e.teams] : [];
    };
    const ourTeams = this.ev.teams.map((t) => t.number).sort((a, b) => a - b);
    const all = DIVS.map((d) => {
      let nums = d === this.div && champs ? ourTeams : divTeams(d).sort((a, b) => a - b);
      if (!nums.length) nums = Array.from({ length: 75 }, (_, i) => 1000 + i);
      if (d === this.div && !nums.includes(this.g.team.number)) nums = [...nums.slice(0, -1), this.g.team.number].sort((a, b) => a - b);
      return [d, nums];
    });
    const n = all.reduce((s, [, x]) => s + x.length, 0);
    const carpet = K.std(0x30343c, { roughness: 1 }), drapeM = K.std(0x232a40, { roughness: 1 }), table = K.std(0x8a6a45);
    const floorI = new THREE.InstancedMesh(new THREE.PlaneGeometry(B - 0.05, B - 0.05), carpet, n);
    const backI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 2.4, B), drapeM, n);
    const sideI = new THREE.InstancedMesh(new THREE.BoxGeometry(B, 1, 0.05), drapeM, 2 * n);
    const tableI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.85, 1.6), table, n);
    const botI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.45, 0.75), K.std(0x8c939c, { metalness: 0.2 }), n);
    const bumpI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.13, 0.9), K.std(0xffffff, { roughness: 0.8 }), n);
    const banI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.6, 2.4), K.std(0xffffff, { roughness: 0.8 }), n);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color(), one = new THREE.Vector3(1, 1, 1);
    const put = (mesh, i, x, y, z, rx = 0) => { e.set(rx, 0, 0); q.setFromEuler(e); mt.compose(new THREE.Vector3(x, y, z), q, one); mesh.setMatrixAt(i, mt); };
    const COLS = [0x1f5fd6, 0xb3262e, 0x2f9e5b, 0x7b4bd1, 0xe07a1f, 0x1b1d22, 0xc9a227, 0x0b7285];
    let i = 0;
    this.booths = [];
    for (const [d, nums] of all) {
      const [hall, qx, qz] = QUAD[d], air = hall === 0 ? this.airA : this.airE, dir = hall === 0 ? -1 : 1;
      const W = PAIRS * PAIR + 2;
      const x0 = hall === 0 ? air - 6 - (2 - qx) * W : air + 6 + qx * W;   // west edge of the block
      const z0 = qz === 0 ? -34 : 2.5;
      const title = plane(signTex(NAME[d].toUpperCase(), 1024, 160, '#14213d', '#f6d31c', 'bold 100px system-ui'), 8, 1.25);
      title.position.set(x0 + W / 2, 6.5, z0 + (qz === 0 ? -1 : ROWS * B + 1)); r.add(title);
      nums.forEach((num, k) => {
        const p = Math.floor(k / (ROWS * 2)), rem = k % (ROWS * 2), side = rem < ROWS ? 0 : 1, row = rem % ROWS;
        if (p >= PAIRS) return;
        const face = side === 0 ? -1 : 1;   // opens west onto the street on its left, or east
        const x = x0 + STREET + p * PAIR + B / 2 + side * B, z = z0 + B / 2 + row * B;
        put(floorI, i, x, 0.003, z, -Math.PI / 2);
        put(backI, i, x - face * B / 2, 1.2, z);
        put(sideI, 2 * i, x, 0.5, z - B / 2); put(sideI, 2 * i + 1, x, 0.5, z + B / 2);
        put(tableI, i, x - face * (B / 2 - 0.4), 0.42, z - 0.6);
        const mine = num === this.g.team.number && d === this.div;
        put(botI, i, mine ? 0 : x + face * 0.3, mine ? -9 : 0.75, z + 0.4);
        put(bumpI, i, mine ? 0 : x + face * 0.3, mine ? -9 : 0.6, z + 0.4);
        bumpI.setColorAt(i, col.setHex(i % 2 ? 0xb3262e : 0x1f5fd6));
        put(banI, i, x - face * (B / 2 - 0.06), 2.1, z);
        banI.setColorAt(i, col.setHex(mine ? 0xf2a51a : COLS[num % COLS.length]));
        // Team numbers on the banners of our own division.
        if (d === this.div) {
          const t = plane(signTex(String(num), 256, 64, mine ? '#f2a51a' : `#${COLS[num % COLS.length].toString(16).padStart(6, '0')}`, '#fff', 'bold 46px system-ui'), 2.3, 0.575);
          t.position.set(x - face * (B / 2 - 0.09), 2.1, z); t.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
          r.add(t);
        }
        this.solid.push({ x0: x - face * B / 2 - 0.05, x1: x - face * B / 2 + 0.05, z0: z - B / 2, z1: z + B / 2 });
        const b = { num, x, z, face, street: x + face * (B / 2 + STREET / 2) };
        this.booths.push(b);
        if (mine) this.myBooth = b;
        i++;
      });
    }
    for (const m of [floorI, backI, sideI, tableI, botI, bumpI, banI]) { m.count = m === sideI ? 2 * i : i; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; r.add(m); }
    this.pitEnd = SOUTH_WALL;
    // Our gear.
    const b = this.myBooth ?? this.booths[0];
    this.myBooth = b;
    this.cartM = K.cart();
    this.cartHome = this.pitHome = { x: b.x + b.face * 0.25, z: b.z + 0.3 };
    // Einstein: teams wait with their carts beside the field (CARTS on the official layout).
    if (this.einstein) {
      this.cartHome = this.pitHome = { x: -BAY, z: -1.2 };
      const cs = K.signMesh('CARTS', 0.9); cs.position.set(-BAY, 2.2, -3); r.add(cs);
    }
    this.cartM.group.position.set(this.cartHome.x, 0, this.cartHome.z);
    r.add(this.cartM.group);
    this.inter.push({ obj: this.cartM.group, kind: 'robot', label: '我們的機器人' });
    const batt = new THREE.Group();
    K.box(0.4, 0.7, 0.55, K.MAT.grey, 0, 0.35, 0, batt);
    for (let k = 0; k < 3; k++) K.box(0.18, 0.17, 0.16, K.MAT.black, 0, 0.79, -0.18 + k * 0.18, batt);
    batt.position.set(this.einstein ? -BAY : b.x - b.face * 0.9, 0, this.einstein ? -3.6 : b.z - 1.05);
    r.add(batt);
    this.inter.push({ obj: batt, kind: 'battery', label: '電池與充電器' });
    const tb = this.einstein ? K.box(0.45, 0.95, 0.7, K.MAT.red, -BAY, 0.48, -5.6, r) : K.box(0.45, 0.95, 0.7, K.MAT.red, b.x - b.face * (B / 2 - 0.35), 0.48, b.z + 1.05, r);
    this.inter.push({ obj: tb, kind: 'pitcrew', label: 'Pit 白板（隊員分工）' });
    for (const p of [{ x: b.x, z: b.z }]) { const l = new THREE.PointLight(0xfff2e0, 14, 18, 1.6); l.position.set(p.x, 7, p.z); this.scene.add(l); }
  }

  // Where to stand in front of our booth, looking in.
  get boothFront() {
    if (this.einstein) return { x: -BAY, z: 1.6, yaw: 0 };
    const b = this.myBooth;
    return { x: b.street, z: b.z, yaw: b.face > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
  get entry() { return { x: this.myBooth.street, z: SOUTH_WALL - 2 }; }
  get adminSpot() { return this.admin; }
  inStands(p = this.player) { const a = Math.abs(p.z); return Math.abs(p.x) < BLEACH_HALF && a > HW + 0.4 && a < BLEACH_IN + 0.1; }

  standPoint(st, idx) {
    const b = this.myBooth;
    if (st === 'scout') return { x: -6 + idx * 0.8, z: -(HW + 1.3), face: Math.PI };
    if (st === 'runner' && ['queue', 'carried'].includes(this.g.robotPos)) return { x: this.queueSpot.x - 1.5, z: this.queueSpot.z, face: 0 };
    if (st === 'drive' && this.g.robotPos === 'field') return { x: -HL - 0.6, z: -1 + idx * 0.6, face: -Math.PI / 2 };
    return { x: b.x - b.face * 0.4, z: b.z - 0.8 + (idx % 3) * 0.7, face: b.face > 0 ? -Math.PI / 2 : Math.PI / 2 };
  }
  // Streets run north–south; everything else connects along the corridor south of the bleachers.
  route(p, t) {
    const zc = AISLE_Z;
    const bay = (x) => (x > 0 ? BAY : -BAY);
    const inField = (q) => Math.abs(q.x) < BLEACH_HALF + 1 && Math.abs(q.z) < BLEACH_IN + 0.2;
    const pts = [];
    if (inField(p)) pts.push({ x: bay(p.x), z: p.z }, { x: bay(p.x), z: zc });
    else pts.push({ x: p.x, z: zc });
    if (inField(t)) pts.push({ x: bay(t.x), z: zc }, { x: bay(t.x), z: t.z });
    else pts.push({ x: t.x, z: zc });
    pts.push({ x: t.x, z: t.z });
    return pts;
  }

  // Our robot cart: in our pit, in front of you, or in the queue (from the Venue).
  sync() {
    const ev = this.ev, d = Math.floor(this.g.t / 1440) - (ev.D ?? 0) + 1;
    this.alliancePits.visible = d >= 3 && !this.einstein;
    // Saturday playoffs: our robot lives in our alliance's pit behind the north bleachers.
    const k = ev.sel?.alliances?.findIndex((a) => a.includes(this.g.team.number)) ?? -1;
    this.cartHome = !this.einstein && k >= 0 && ev.phase !== 'quals' ? { x: -8.4 + k * 2.4, z: -(BLEACH_IN + NORTH_ROWS * SEAT) - 2.6 } : this.pitHome;
    super.sync();
  }

  animate() {
    const u = this.inspector.group, a = this.admin, side = QUAD[this.div][0] === 0 ? 1 : -1;
    const home = { x: a.x - side * 1.4, z: a.z + 1.5 };
    const insp = this.g.insp?.state === 'coming' || this.g.insp?.state === 'here';
    const f = this.boothFront, tx = insp ? f.x : home.x, tz = insp ? f.z + 1 : home.z;
    u.position.x += (tx - u.position.x) * 0.02; u.position.z += (tz - u.position.z) * 0.02;
  }
}
