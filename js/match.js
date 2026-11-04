import { TIMING, TELEOP, HUB_GRACE, SCORE, RP, other } from './config.js';

// Match clock, HUB shifts and scoring.
// mode: 'match' (full timer) or 'practice' (no clock, HUBs always active).
export class Match {
  constructor(mode) {
    this.mode = mode;
    this.t = 0;               // seconds since the match was started (including countdown)
    this.phase = mode === 'practice' ? 'practice' : 'countdown';
    this.score = { red: blank(), blue: blank() };
    this.autoWinner = null;
    this.lastActive = { red: -99, blue: -99 };
    this.events = [];
  }

  get countdownEnd() { return TIMING.countdown; }
  get autoEnd() { return this.countdownEnd + TIMING.auto; }
  get teleStart() { return this.autoEnd + TIMING.pause; }
  get matchEnd() { return this.teleStart + TELEOP; }

  get enabled() { return this.phase === 'auto' || this.phase === 'teleop' || this.phase === 'practice'; }

  // Seconds left on the displayed clock for the current period.
  get clock() {
    if (this.phase === 'countdown') return TIMING.auto;
    if (this.phase === 'auto') return Math.max(0, this.autoEnd - this.t);
    if (this.phase === 'pause') return TELEOP;
    if (this.phase === 'teleop') return Math.max(0, this.matchEnd - this.t);
    return 0;
  }

  get teleT() { return this.t - this.teleStart; }

  // Name of the teleop segment and when it ends (in clock seconds).
  segment(t = this.teleT) {
    if (t < TIMING.transition) return { name: 'Transition', idx: 0, end: TIMING.transition };
    const s = Math.floor((t - TIMING.transition) / TIMING.shift);
    if (s < 4) return { name: `Shift ${s + 1}`, idx: s + 1, end: TIMING.transition + (s + 1) * TIMING.shift };
    return { name: 'Endgame', idx: 5, end: TELEOP };
  }

  hubActiveAt(alliance, t) {
    if (this.phase === 'practice') return true;
    if (t < this.teleStart) return t >= this.countdownEnd;
    const seg = this.segment(t - this.teleStart);
    if (seg.idx === 0 || seg.idx === 5) return t < this.matchEnd;
    // The alliance that won AUTO has its HUB inactive first (shifts 1 and 3).
    const winnerOff = seg.idx === 1 || seg.idx === 3;
    return alliance === this.autoWinner ? !winnerOff : winnerOff;
  }

  hubActive(alliance) { return this.hubActiveAt(alliance, this.t); }

  // FUEL still counts for a few seconds after the HUB switches off.
  hubScoring(alliance) {
    if (this.phase === 'countdown') return false;
    return this.hubActive(alliance) || this.t - this.lastActive[alliance] <= HUB_GRACE;
  }

  // Seconds until this HUB toggles, or null if it stays put.
  nextToggle(alliance) {
    if (this.phase !== 'teleop' && this.phase !== 'pause') return null;
    const now = this.hubActive(alliance);
    for (let dt = 0.25; dt < 60; dt += 0.25) {
      if (this.t + dt > this.matchEnd) return null;
      if (this.hubActiveAt(alliance, this.t + dt) !== now) return dt;
    }
    return null;
  }

  scoreFuel(alliance) {
    if (!this.hubScoring(alliance)) return false;
    const auto = this.t <= this.autoEnd + HUB_GRACE && this.phase !== 'teleop';
    if (auto) this.score[alliance].autoFuel += SCORE.fuel;
    else this.score[alliance].teleFuel += SCORE.fuel;
    return true;
  }

  update(dt, robots) {
    this.t += dt;
    for (const a of ['red', 'blue']) if (this.hubActive(a)) this.lastActive[a] = this.t;
    if (this.phase === 'practice') return;

    if (this.phase === 'countdown' && this.t >= this.countdownEnd) this.setPhase('auto');
    if (this.phase === 'auto' && this.t >= this.autoEnd) {
      // AUTO tower points: L1 is worth 15 for each robot hanging at the buzzer.
      for (const r of robots) if (r.climbLevel >= 1) this.score[r.alliance].autoTower += SCORE.autoL1;
      this.setPhase('pause');
    }
    if (this.phase === 'pause' && this.t >= this.teleStart + 0) {
      const r = this.score.red.autoFuel, b = this.score.blue.autoFuel;
      this.autoWinner = r > b ? 'red' : b > r ? 'blue' : (Math.random() < 0.5 ? 'red' : 'blue');
      this.events.push({ type: 'autoWinner', alliance: this.autoWinner });
      this.setPhase('teleop');
    }
    if (this.phase === 'teleop' && this.t >= this.matchEnd) {
      for (const r of robots) this.score[r.alliance].teleTower += SCORE.levels[r.climbLevel] || 0;
      this.setPhase('post');
    }
    if (this.phase === 'post' && this.t >= this.matchEnd + HUB_GRACE + 1 && !this.finished) {
      this.finished = true;
      this.events.push({ type: 'final' });
    }
  }

  setPhase(p) {
    this.phase = p;
    this.events.push({ type: 'phase', phase: p });
  }

  total(a) {
    const s = this.score[a];
    return s.autoFuel + s.teleFuel + s.autoTower + s.teleTower;
  }

  rankingPoints(a) {
    const s = this.score[a];
    const fuel = s.autoFuel + s.teleFuel;
    const tower = s.autoTower + s.teleTower;
    const mine = this.total(a), theirs = this.total(other(a));
    return {
      win: mine > theirs ? 3 : mine === theirs ? 1 : 0,
      energized: fuel >= RP.energized ? 1 : 0,
      supercharged: fuel >= RP.supercharged ? 1 : 0,
      traversal: tower >= RP.traversal ? 1 : 0,
    };
  }
}

function blank() { return { autoFuel: 0, teleFuel: 0, autoTower: 0, teleTower: 0 }; }
