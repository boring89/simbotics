// Keyboard + gamepad. Edge-triggered actions are exposed through pressed().
export class Input {
  constructor() {
    this.keys = new Set();
    this.edges = new Set();
    this.mouse = false;
    this.prevPad = [];
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    const canvas = document.getElementById('view');
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouse = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // Polled once per frame.
  read() {
    const k = (c) => this.keys.has(c);
    let fx = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    let fy = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    let rot = (k('KeyJ') || k('ArrowLeft') ? 1 : 0) - (k('KeyL') || k('ArrowRight') ? 1 : 0);
    let shoot = k('Space') || this.mouse;
    let intake = k('ShiftLeft') || k('ShiftRight') || k('KeyK');

    const p = this.pad();
    const padEdges = new Set();
    if (p) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0), rx = dz(p.axes[2] || 0);
      if (lx || ly) { fx = -ly; fy = lx; }
      if (rx) rot = -rx;
      const b = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.4));
      if (b(7) || b(5)) shoot = true;
      if (b(6) || b(4)) intake = true;
      const map = { 0: 'KeyC', 1: 'KeyX', 3: 'KeyV', 9: 'Escape', 2: 'KeyI' };
      for (const i in map) {
        const now = b(+i);
        if (now && !this.prevPad[i]) padEdges.add(map[i]);
        this.prevPad[i] = now;
      }
    }
    for (const e of padEdges) this.edges.add(e);
    return { fx, fy, rot, shoot, intake };
  }

  pressed(code) {
    if (this.edges.has(code)) { this.edges.delete(code); return true; }
    return false;
  }

  clearEdges() { this.edges.clear(); }
}
