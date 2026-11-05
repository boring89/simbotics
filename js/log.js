import { HL, HUB_X, ZONE_X, BUMP, TRENCH, side } from './config.js';

// Log mode: samples the player's robot four times a second and sums it up per match
// segment, as plain text that can be pasted back for tuning the bots.
// Positions are alliance-local: own wall at +x, so red and blue logs read the same.
const DT = 0.25;

// O own zone, B own BUMP/TRENCH line, N neutral, b their BUMP/TRENCH line, X their zone.
function region(lx, lz) {
  const onLine = (x) => Math.abs(x - HUB_X) < BUMP.depth / 2 && Math.abs(lz) > BUMP.zMin;
  if (onLine(lx)) return Math.abs(lz) > TRENCH.zMin ? 'T' : 'B';
  if (onLine(-lx)) return Math.abs(lz) > TRENCH.zMin ? 't' : 'b';
  if (lx > ZONE_X) return 'O';
  if (lx < -ZONE_X) return 'X';
  return 'N';
}

// Real robots carry their team number in the name; a copy under another number says whose it is.
export function robotName(r) {
  let name = r.p.team ? r.p.name.replace(/^\d+\s*/, '') : r.p.name;
  if (r.p.team && r.number !== r.p.team) name += `（${r.p.team} 複製）`;
  return name;
}

export class MatchLog {
  constructor(world, settings) {
    this.w = world;
    this.settings = settings;
    this.rows = [];
    this.events = [];
    this.segs = new Map();
    this.next = 0;
    this.last = null;
  }

  segName() {
    const m = this.w.match;
    if (m.phase === 'auto') return 'Auto';
    if (m.phase === 'pause') return 'Pause';
    return m.segment().name;
  }

  // Called once per physics step.
  step(dt) {
    const m = this.w.match, p = this.w.player;
    if (!m.enabled && m.phase !== 'pause') return;
    const seg = this.segName();
    const s = side(p.alliance);
    const lx = s * p.x, lz = s * p.z;
    const reg = region(lx, lz);

    // Per-segment totals accumulate every step; rows are sampled.
    let g = this.segs.get(seg);
    if (!g) {
      g = { t: 0, reg: {}, fuelT: 0, shootT: 0, contactT: 0, start: { ...p.stats }, end: null };
      this.segs.set(seg, g);
    }
    g.t += dt;
    g.reg[reg] = (g.reg[reg] || 0) + dt;
    g.fuelT += p.fuel * dt;
    if (p.shooting) g.shootT += dt;
    if (p.contactT > 0) g.contactT += dt;
    g.end = { ...p.stats };

    if (this.last && this.last.seg !== seg) this.events.push(`${this.time()} 進入 ${seg}`);
    if (this.last && this.last.climb !== p.climbLevel) this.events.push(`${this.time()} TOWER L${p.climbLevel}`);
    this.last = { seg, climb: p.climbLevel };

    if (m.t < this.next) return;
    this.next = m.t + DT;
    const opp = this.w.robots.filter((r) => r.alliance !== p.alliance);
    const mate = this.w.robots.filter((r) => r.alliance === p.alliance && r !== p);
    const near = (list) => (list.length ? Math.min(...list.map((r) => Math.hypot(r.x - p.x, r.z - p.z))).toFixed(1) : '');
    const h = ((p.h + (s < 0 ? Math.PI : 0)) * 180 / Math.PI + 540) % 360 - 180;
    this.rows.push([
      this.time(),
      seg === 'Auto' ? 'A' : seg === 'Pause' ? 'P' : seg === 'Transition' ? 'T' : seg === 'Endgame' ? 'E' : `S${seg.slice(-1)}`,
      `${m.hubActive(p.alliance) ? 1 : 0}${m.hubActive(p.alliance === 'red' ? 'blue' : 'red') ? 1 : 0}`,
      lx.toFixed(2), lz.toFixed(2), Math.round(h),
      Math.hypot(p.vx, p.vz).toFixed(1),
      reg, p.fuel,
      p.shooting ? (p.aimMode === 'hub' ? 'S' : 'P') : '', p.intakeOn ? 'I' : '',
      p.contactT > 0 ? 'C' : '',
      near(opp), near(mate),
      p.stats.scored, p.stats.intaked,
    ].join(','));
  }

  time() {
    const m = this.w.match;
    return (m.t - m.countdownEnd).toFixed(2);
  }

  text() {
    const w = this.w, m = w.match, p = w.player, st = this.settings;
    const robot = (r) => `${r.alliance === 'red' ? '紅' : '藍'} ${r.number} ${robotName(r)}${r.isPlayer ? '（玩家）' : ''}`;
    const sum = [...this.segs].map(([name, g]) => {
      const d = (k) => g.end[k] - g.start[k];
      const reg = Object.entries(g.reg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v.toFixed(1)}`).join(' ');
      return `${name.padEnd(10)} ${g.t.toFixed(1).padStart(5)}s  進球 ${String(d('scored')).padStart(3)}  射 ${String(d('shots')).padStart(3)}  傳 ${String(d('passes')).padStart(3)}  吸 ${String(d('intaked')).padStart(3)}  平均載球 ${(g.fuelT / g.t).toFixed(1).padStart(4)}  射擊 ${g.shootT.toFixed(1)}s  碰撞 ${g.contactT.toFixed(1)}s  位置 ${reg}`;
    });
    return [
      '# Simbotics 操作記錄 v1',
      `# 模式 ${st.mode} · 玩家 ${robot(p)} · 隊友 AI ${st.allySkill}/${st.allyTactic} · 對手 AI ${st.oppSkill}/${st.oppTactic}`,
      `# 機器人：${w.robots.map(robot).join('、')}`,
      `# 比分 紅 ${m.total('red')} : 藍 ${m.total('blue')} · 玩家 進球 ${p.stats.scored} 射 ${p.stats.shots} 傳 ${p.stats.passes} 吸 ${p.stats.intaked} TOWER L${p.climbLevel}`,
      `# 座標以己方聯盟為準：己方牆在 +x（x=${HL.toFixed(2)}），己方區域 x>${ZONE_X.toFixed(2)}，HUB 在 x=±${HUB_X}`,
      '# 位置代號：O 己方區域、B/T 己方 BUMP/TRENCH、N 中場、b/t 對方 BUMP/TRENCH、X 對方區域',
      '',
      '## 各時段',
      ...sum,
      '',
      '## 事件',
      ...this.events,
      '',
      '## 取樣（每 0.25 秒）',
      '# t=AUTO 起算秒數, seg, hub=己方/對方啟用, x, z, 車頭角度（0=朝己方牆, ±180=朝對方）, 速度 m/s, 位置, 載球, 射擊(S=HUB P=傳球), intake, 碰撞, 最近對手 m, 最近隊友 m, 累計進球, 累計吸入',
      't,seg,hub,x,z,h,v,reg,fuel,sh,in,ct,opp,mate,sc,ik',
      ...this.rows,
    ].join('\n');
  }
}
