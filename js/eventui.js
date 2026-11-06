import { LEVELS, rankings, candidates, playoffs, ready, lineup, playerPick, playerRespond, teamName, save } from './event.js';

// The event screen: next match, schedule, rankings, alliance selection and the playoff bracket.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PHASE = { quals: '資格賽', selection: '聯盟選擇', playoffs: '淘汰賽', done: '賽事結束' };
const f1 = (x) => x.toFixed(1);

export class EventUI {
  constructor(runner, { play, menu }) {
    this.runner = runner;
    this.play = play;
    this.menu = menu;
    this.tab = null;
    $('event').addEventListener('click', (e) => this.click(e));
  }

  get ev() { return this.runner.ev; }
  get open() { return !$('event').hidden; }
  show() { $('event').hidden = false; this.runner.pump(); this.render(); }
  hide() { $('event').hidden = true; }
  refresh() { if (this.open) this.render(); }

  click(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const ev = this.ev, act = el.dataset.act;
    if (act === 'menu') { this.hide(); this.menu(); return; }
    if (act === 'abandon') { if (ev?.phase === 'done' || confirm('放棄這場賽事？進度會刪除。')) { this.runner.abandon(); this.hide(); this.menu(); } return; }
    if (act === 'tab') { this.tab = el.dataset.tab; this.render(); return; }
    if (act === 'play') { this.hide(); this.play(el.dataset.id); return; }
    if (act === 'sim') { this.runner.pump(el.dataset.id); this.render(); return; }
    if (act === 'pick') playerPick(ev, +el.dataset.team);
    if (act === 'accept') playerRespond(ev, true);
    if (act === 'decline') playerRespond(ev, false);
    save(ev);
    this.runner.pump();
    this.render();
  }

  render() {
    const ev = this.ev;
    if (!ev) { $('event-body').innerHTML = '<p>沒有進行中的賽事。</p><button data-act="menu">主選單</button>'; return; }
    const tab = this.tab || (ev.phase === 'quals' || ev.phase === 'selection' ? 'rank' : 'bracket');
    const qDone = ev.quals.filter((m) => m.result).length;
    $('event-body').innerHTML = `
      <div class="ev-head">
        <div><span class="season">${LEVELS[ev.level].name} · ${ev.size} 隊 · 你是 ${ev.me}</span><h2>${PHASE[ev.phase]}</h2></div>
        <div class="ev-tools"><button data-act="menu">主選單</button><button data-act="abandon">${ev.phase === 'done' ? '結束賽事' : '放棄賽事'}</button></div>
      </div>
      <div class="ev-next">${this.next()}</div>
      <div class="ev-progress">資格賽 ${qDone} / ${ev.quals.length} 場${this.runner.running ? ` · 背景還有 ${this.runner.running} 場在跑` : ''}</div>
      <div class="ev-tabs">
        ${[['rank', '排名'], ['sched', '賽程'], ['bracket', '聯盟 / 淘汰賽']].map(([k, n]) => `<button data-act="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}
      </div>
      <div class="ev-view">${tab === 'rank' ? this.rankTable() : tab === 'sched' ? this.schedule() : this.bracket()}</div>`;
  }

  // The card at the top: what the player does next.
  next() {
    const ev = this.ev;
    if (ev.phase === 'selection') return this.selection();
    if (ev.phase === 'done') {
      const po = playoffs(ev), al = ev.sel.alliances[po.champion];
      const won = al.includes(ev.me);
      return `<div class="ev-champ ${won ? 'me' : ''}">🏆 冠軍：第 ${po.champion + 1} 聯盟 — ${al.map((n) => this.tn(n)).join('、')}${won ? '<br><b>你的聯盟奪冠！</b>' : ''}</div>`;
    }
    const mine = ready(ev).find((m) => m.mine);
    if (mine) {
      const lu = lineup(ev, mine.id);
      const color = lu.red.includes(ev.me) ? 'red' : 'blue', opp = color === 'red' ? 'blue' : 'red';
      const label = mine.id[0] === 'Q' ? mine.id : `${mine.id} · ${playoffs(ev).find((p) => p.id === mine.id).round}`;
      const busy = this.runner.busy.has(mine.id);
      return `<div class="ev-match">
        <div><b>下一場 ${label}</b> · 你在<span class="${color[0]}">${color === 'red' ? '紅' : '藍'}聯盟</span></div>
        <div class="ev-vs"><span class="${color[0]}">${lu[color].map((n) => this.tn(n)).join('<br>')}</span><i>vs</i><span class="${opp[0]}">${lu[opp].map((n) => this.tn(n)).join('<br>')}</span></div>
        ${busy ? '<p class="muted">電腦正在代打這場…</p>' : `<button class="primary" data-act="play" data-id="${mine.id}">上場</button><button data-act="sim" data-id="${mine.id}">自動模擬</button>`}
      </div>`;
    }
    if (ev.phase === 'quals') return '<p>你的資格賽都打完了，等其他場次跑完就開始選聯盟。</p>';
    const inAlliance = ev.sel.alliances.some((a) => a.includes(ev.me));
    if (!inAlliance) return '<p>你沒有被選進聯盟，淘汰賽由電腦打完。</p>';
    const po = playoffs(ev), k = ev.sel.alliances.findIndex((a) => a.includes(ev.me));
    const losses = po.filter((m) => m.result && m.loser === k && m.id[0] === 'M').length;
    if (losses >= 2 || po.some((m) => m.id === 'M13' && m.result && m.loser === k)) return '<p>你的聯盟已被淘汰，剩下的比賽由電腦打完。</p>';
    return '<p>等其他場次結束…</p>';
  }

  selection() {
    const ev = this.ev, s = ev.sel, p = s.pending;
    let head = '';
    if (p?.type === 'pick') {
      const rank = new Map(rankings(ev).map((r, i) => [r.number, i + 1]));
      const rows = candidates(ev).map((r) => `<tr><td>${rank.get(r.number)}</td><td>${this.tn(r.number)}</td><td>${f1(r.avgRp)}</td><td>${f1(r.avgScored)}</td><td>${f1(r.avgClimb)}</td><td>${f1(r.avgPasses)}</td><td><button data-act="pick" data-team="${r.number}">邀請</button></td></tr>`).join('');
      head = `<p><b>你是第 ${p.k + 1} 聯盟的隊長</b>，選一支隊伍加入（${s.turn < 8 ? '第一輪' : '第二輪'}）。</p>
        <div class="ev-table"><table><tr><th>#</th><th>隊伍</th><th>RP</th><th>進球</th><th>爬升</th><th>傳球</th><th></th></tr>${rows}</table></div>`;
    } else if (p?.type === 'invite') {
      const cap = s.alliances[p.k][0];
      head = `<p><b>第 ${p.k + 1} 聯盟隊長 ${this.tn(cap)}</b> 邀請你加入。</p>
        <button class="primary" data-act="accept">接受</button><button data-act="decline">拒絕</button>
        <p class="muted">拒絕之後不能再被其他聯盟選，但排名夠高時仍可能當隊長。</p>`;
    }
    return head + this.alliances();
  }

  alliances() {
    const s = this.ev.sel;
    if (!s) return '';
    const rows = s.alliances.map((a, i) => `<tr><td>${i + 1}</td>${[0, 1, 2].map((j) => `<td>${a[j] ? this.tn(a[j]) : '—'}</td>`).join('')}</tr>`).join('');
    return `<div class="ev-table"><table><tr><th>#</th><th>隊長</th><th>第一指名</th><th>第二指名</th></tr>${rows}</table></div>`;
  }

  rankTable() {
    const ev = this.ev;
    const rows = rankings(ev).map((r, i) => `<tr class="${r.number === ev.me ? 'me' : ''}"><td>${i + 1}</td><td>${this.tn(r.number)}</td><td>${r.played ? f1(r.avgRp) : '—'}</td><td>${r.w}-${r.l}-${r.t}</td><td>${r.played ? Math.round(r.avgPts) : '—'}</td><td>${r.played ? f1(r.avgScored) : '—'}</td><td>${r.played ? f1(r.avgClimb) : '—'}</td><td>${r.played ? f1(r.avgPasses) : '—'}</td></tr>`).join('');
    return `<div class="ev-table"><table><tr><th>#</th><th>隊伍</th><th>RP</th><th>勝-敗-和</th><th>平均分</th><th>進球</th><th>爬升</th><th>傳球</th></tr>${rows}</table></div>
      <p class="muted">RP 與後面幾欄都是每場平均。進球、爬升、傳球是那台機器人自己的數字，選聯盟時電腦看的是「進球 + 爬升分 + 傳球 × 0.5」。</p>`;
  }

  schedule() {
    const ev = this.ev;
    const side = (m, a) => m[a].map((n) => (n === ev.me ? `<b class="me">${n}</b>` : n)).join(' ');
    const rows = ev.quals.map((m) => {
      const r = m.result, mine = [...m.red, ...m.blue].includes(ev.me);
      const score = r ? `<span class="${r.red.total > r.blue.total ? 'r win' : 'r'}">${r.red.total}</span> : <span class="${r.blue.total > r.red.total ? 'b win' : 'b'}">${r.blue.total}</span>` : this.runner.busy.has(m.id) ? '<span class="muted">模擬中</span>' : '';
      return `<tr class="${mine ? 'me' : ''}"><td>${m.id}</td><td class="r">${side(m, 'red')}</td><td class="b">${side(m, 'blue')}</td><td>${score}</td></tr>`;
    }).join('');
    return `<div class="ev-table"><table><tr><th>場次</th><th>紅</th><th>藍</th><th>比分</th></tr>${rows}</table></div>`;
  }

  bracket() {
    const ev = this.ev;
    if (!ev.sel) return '<p class="muted">資格賽結束後會在這裡選聯盟。</p>';
    if (!ev.po) return this.alliances();
    const po = playoffs(ev);
    const al = (k) => (k === null ? '<span class="muted">待定</span>' : `第 ${k + 1} 聯盟 <small>${ev.sel.alliances[k].join(' ')}</small>`);
    const rows = po.filter((m) => !m.skip).map((m) => {
      const r = m.result, mine = m.a !== null && m.b !== null && [...ev.sel.alliances[m.a], ...ev.sel.alliances[m.b]].includes(ev.me);
      const score = r ? `<span class="${m.winner === m.a ? 'r win' : 'r'}">${r.red.total}</span> : <span class="${m.winner === m.b ? 'b win' : 'b'}">${r.blue.total}</span>` : this.runner.busy.has(m.id) ? '<span class="muted">模擬中</span>' : '';
      return `<tr class="${mine ? 'me' : ''}"><td>${m.id}</td><td>${m.round}</td><td class="r">${al(m.a)}</td><td class="b">${al(m.b)}</td><td>${score}</td></tr>`;
    }).join('');
    return `${this.alliances()}<div class="ev-table"><table><tr><th>場次</th><th>輪次</th><th>紅</th><th>藍</th><th>比分</th></tr>${rows}</table></div>
      <p class="muted">雙敗淘汰：輸兩場出局。總決賽三戰兩勝。平手先比 TOWER 分，再比 AUTO 分，再來是種子較高的聯盟。</p>`;
  }

  tn(n) { return `<span class="${n === this.ev.me ? 'me' : ''}">${esc(teamName(this.ev, n))}</span>`; }
}
