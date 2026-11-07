import * as THREE from '../../three.js';
import { Op, IN, clamp, mats } from './base.js';

// Lathe: the stock is a profile of radii along its length. With the spindle on, wherever the tool
// tip passes, material above the tip's radius is removed. Face the end, turn the diameter down
// in passes, then part the piece off at length. Measure with the caliper (M).

const DZ = 0.01;              // in per slice
const RPMS = [300, 700, 1200, 2000];
const TIP = 0.012;            // half width of the tool tip, in

export class LatheOp extends Op {
  enter() {
    const s = this.p.spec;
    this.target = s.target; this.L = s.len;
    this.S = s.len + 0.7;                       // stick-out from the chuck
    this.N = Math.round(this.S / DZ);
    this.r = new Float32Array(this.N).fill(s.dia / 2);
    for (let i = 0; i < 5; i++) this.r[i] = s.dia / 2 - 0.02 - Math.random() * 0.12;   // sawn, ragged end
    this.tz = -0.25; this.tx = s.dia / 2 + 0.15;
    this.rpm = 1; this.motor = false;
    this.chatter = 0; this.crashes = 0; this.lowRpm = 0;
    this.freeX = this.m.chuckX + this.S * IN;
    this.dirty = true; this.lastGeo = 0;
    this.spin = new THREE.Group();
    this.spin.position.set(this.freeX, this.m.axisY, 0);
    this.add(this.spin);
    this.tool = this.mesh(new THREE.BoxGeometry(0.012, 0.012, 0.09), new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.4 }), 0, this.m.axisY, 0);
    const tip = this.mesh(new THREE.ConeGeometry(0.004, 0.012, 4), new THREE.MeshStandardMaterial({ color: 0x333333 }), 0, 0, -0.051, this.tool);
    tip.rotation.x = -Math.PI / 2;
    this.m.tool.visible = false;
    this.rebuild();
    this.render();
  }

  render() {
    this.panel({
      title: `車床 · ${this.p.name}`,
      info: `圖面：外徑 <b>${this.target.toFixed(3)} in</b>，長度 <b>${this.L.toFixed(2)} in</b>（料：${this.p.spec.dia} in 圓棒）`,
      steps: ['選轉速（1–4，建議 1200–2000）並開主軸（E）', '車端面：刀尖靠近料頭，往中心進刀', '車外徑：分幾刀車到圖面尺寸（每刀半徑 ≤ 0.04 in）', `在距離端面 ${this.L} in 處切斷`],
      hint: 'A／D 床鞍左右（Shift 微調）· W／S 橫刀座進退 · 滾輪＝刻度盤微調 0.002 in · M 卡尺量測 · E 主軸',
    });
  }

  key(code, down) {
    super.key(code, down);
    if (!down) return;
    const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
    if (i >= 0) { this.rpm = i; this.msg(`轉速 ${RPMS[i]} RPM`); }
    if (code === 'KeyE') { this.motor = !this.motor; this.msg(this.motor ? '主軸啟動' : '主軸停止'); if (this.step === 0 && this.motor) { this.step = 1; this.render(); } }
    if (code === 'KeyM') this.measure();
  }
  wheel(dy) { this.tx = Math.max(0, this.tx + (dy > 0 ? -0.002 : 0.002)); this.cutAll(); }

  face() { for (let i = 0; i < this.N; i++) if (this.r[i] > 0.015) return i; return this.N; }

  measure() {
    const c = Math.round(this.tz / DZ);
    let mx = 0;
    for (let i = Math.max(0, c - 5); i <= Math.min(this.N - 1, c + 5); i++) mx = Math.max(mx, this.r[i]);
    const f = this.face();
    this.msg(`卡尺：刀尖處外徑 ${(2 * mx).toFixed(3)} in · 端面到刀尖 ${((c - f) * DZ).toFixed(3)} in`);
  }

  cutAll() {
    const a = Math.max(0, Math.floor((this.tz - TIP) / DZ)), b = Math.min(this.N - 1, Math.ceil((this.tz + TIP) / DZ));
    let deep = 0;
    for (let i = a; i <= b; i++) {
      if (this.r[i] <= this.tx) continue;
      deep = Math.max(deep, this.r[i] - this.tx);
      if (!this.motor) break;
      this.r[i] = Math.max(0, this.tx);
      this.dirty = true;
    }
    if (deep <= 0) return;
    if (!this.motor) { this.crash('主軸沒開就碰到工件，刀片崩了！'); this.tx += 0.1; return; }
    if (deep > 0.12) { this.crash('吃刀太深，刀片崩了！'); return; }
    if (deep > 0.045) { this.chatter += deep * 0.4; this.msg('吃太深了，開始震刀', 'bad'); }
    if (this.rpm < 2) this.lowRpm += deep;
    if (this.step === 1 && this.tx < 0.1 && this.tz < 0.08) { this.step = 2; this.render(); }
    this.checkPart();
  }

  crash(text) {
    this.msg(text, 'bad');
    this.crashes++;
    this.ctx.breakTool('lathe');
    this.tx += 0.08;
    if (this.g.tools.insert <= 0) { this.msg('沒有刀片了，去 MakerMart 買', 'bad'); setTimeout(() => this.ctx.cancel(), 1500); }
  }

  // A slice cut to the centre with material on the free side: that piece drops off.
  checkPart() {
    const f = this.face();
    for (let i = f + 1; i < this.N; i++) {
      if (this.r[i] > 0.015) continue;
      if (i - f < 20) {   // just a thin face slice: that's facing, not parting
        for (let k = f; k < i; k++) this.r[k] = 0;
        this.dirty = true;
        return;
      }
      this.parted(f, i);
      return;
    }
  }

  parted(f, i) {
    const len = (i - f) * DZ;
    const a = f + Math.round((i - f) * 0.06), b = i - Math.round((i - f) * 0.06);
    let sum = 0, mn = 9, mx = 0;
    for (let k = a; k < b; k++) { sum += this.r[k]; mn = Math.min(mn, this.r[k]); mx = Math.max(mx, this.r[k]); }
    const D = 2 * sum / Math.max(1, b - a);
    const errD = Math.abs(D - this.target) + (mx - mn), errL = Math.abs(len - this.L);
    const q = clamp(1 - errD * 10 - errL * 3 - this.chatter - Math.min(0.15, this.lowRpm * 0.2) - this.crashes * 0.08, 0, 1);
    // Drop the finished piece.
    const piece = this.makeMesh(f, i);
    piece.position.copy(this.spin.position);
    this.add(piece);
    for (let k = 0; k < i; k++) this.r[k] = 0;
    this.dirty = true;
    this.dropping = piece;
    this.motor = false;
    this.msg(`切斷！外徑 ${D.toFixed(3)} in，長度 ${len.toFixed(3)} in`, q > 0.6 ? 'ok' : 'bad');
    this.step = 4; this.render();
    setTimeout(() => this.finish(q, `外徑誤差 ${Math.abs(D - this.target).toFixed(3)} in、長度誤差 ${errL.toFixed(3)} in`), 1600);
  }

  makeMesh(a = 0, b = this.N) {
    const pts = [new THREE.Vector2(0, a * DZ * IN)];
    for (let i = a; i < b; i++) { pts.push(new THREE.Vector2(this.r[i] * IN, i * DZ * IN), new THREE.Vector2(this.r[i] * IN, (i + 1) * DZ * IN)); }
    pts.push(new THREE.Vector2(0, b * DZ * IN));
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), mats.alu);
    m.rotation.z = Math.PI / 2;    // lathe +y -> machine -x (toward the chuck)
    m.castShadow = true;
    return m;
  }
  rebuild() {
    if (this.stockMesh) { this.spin.remove(this.stockMesh); this.stockMesh.geometry.dispose(); }
    this.stockMesh = this.makeMesh();
    this.stockMesh.position.set(0, 0, 0);
    this.spin.add(this.stockMesh);
    this.dirty = false;
  }

  update(dt) {
    super.update(dt);
    const fine = this.held('ShiftLeft') || this.held('ShiftRight');
    const zs = (fine ? 0.03 : 0.3) * dt, xs = (fine ? 0.008 : 0.08) * dt;
    if (this.held('KeyA')) this.tz = Math.min(this.S - 0.05, this.tz + zs);
    if (this.held('KeyD')) this.tz = Math.max(-0.6, this.tz - zs);
    if (this.held('KeyW')) this.tx = Math.max(0, this.tx - xs);
    if (this.held('KeyS')) this.tx = Math.min(1.2, this.tx + xs);
    if (!this.over) this.cutAll();
    const now = performance.now();
    if (this.dirty && now - this.lastGeo > 60) { this.lastGeo = now; this.rebuild(); }
    if (this.motor) { this.spin.rotation.x += dt * RPMS[this.rpm] * 0.02; this.m.chuck.rotation.x = this.spin.rotation.x; }
    if (this.dropping) { this.dropping.position.y = Math.max(0.93, this.dropping.position.y - dt * 1.5); }
    const tipX = this.freeX - this.tz * IN;
    this.tool.position.set(tipX, this.m.axisY, this.tx * IN + 0.057);
    this.m.carriage.position.x = tipX;
    this.m.cross.position.z = 0.12 + this.tx * IN + 0.06 - 0.12;
    const z = 0.32 * this.zoom;
    this.cam([tipX + 0.02, this.m.axisY + z * 0.55, z], [tipX - 0.02, this.m.axisY, 0]);
    const f = this.face();
    this.read(`X 直徑 <b>${(2 * this.tx).toFixed(3)}</b> in · Z（距端面）<b>${(this.tz - f * DZ).toFixed(3)}</b> in<br>轉速 <b class="${this.rpm >= 2 ? 'ok' : 'bad'}">${RPMS[this.rpm]}</b> RPM ${this.motor ? '· 運轉中' : '· 停止'}`);
  }

  exit() { this.m.tool.visible = true; this.m.chuck.rotation.x = 0; this.m.carriage.position.x = 0.1; this.m.cross.position.z = 0.12; super.exit(); }
}
