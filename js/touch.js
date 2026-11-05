// Touch controls: a floating move stick on the left half of the screen, a floating aim stick
// on the right half, plus a few buttons. Sticks appear where the thumb lands.
const STICK_R = 56;

class Stick {
  constructor(root, cls) {
    this.base = document.createElement('div');
    this.base.className = `stick ${cls}`;
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.base.appendChild(this.knob);
    root.appendChild(this.base);
    this.id = null;
    this.x = 0; this.y = 0;
  }

  start(t) {
    this.id = t.identifier;
    this.ox = t.clientX; this.oy = t.clientY;
    this.base.style.left = `${this.ox}px`;
    this.base.style.top = `${this.oy}px`;
    this.base.classList.add('on');
    this.move(t);
  }

  move(t) {
    let dx = t.clientX - this.ox, dy = t.clientY - this.oy;
    const d = Math.hypot(dx, dy);
    // Let the base trail the thumb so the stick never runs out of travel.
    if (d > STICK_R) {
      const k = (d - STICK_R) / d;
      this.ox += dx * k; this.oy += dy * k;
      dx -= dx * k; dy -= dy * k;
      this.base.style.left = `${this.ox}px`;
      this.base.style.top = `${this.oy}px`;
    }
    this.x = dx / STICK_R; this.y = dy / STICK_R;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  end() {
    this.id = null;
    this.x = 0; this.y = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('on');
  }
}

export class TouchControls {
  constructor(edges) {
    this.edges = edges;
    this.root = document.getElementById('touch');
    this.zone = document.getElementById('touch-zone');
    this.move = new Stick(this.root, 'move');
    this.aim = new Stick(this.root, 'aim');
    this.shoot = false;

    const owner = (t) => (t.clientX < innerWidth / 2 ? this.move : this.aim);
    this.zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.root.classList.add('used');
      for (const t of e.changedTouches) {
        const s = owner(t);
        if (s.id === null) s.start(t);
      }
    }, { passive: false });
    this.zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) for (const s of [this.move, this.aim]) if (s.id === t.identifier) s.move(t);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) for (const s of [this.move, this.aim]) if (s.id === t.identifier) s.end();
    };
    this.zone.addEventListener('touchend', end);
    this.zone.addEventListener('touchcancel', end);

    // Buttons fire key edges so they share the keyboard code paths.
    for (const b of this.root.querySelectorAll('[data-key]')) {
      b.addEventListener('touchstart', (e) => { e.preventDefault(); this.edges.add(b.dataset.key); }, { passive: false });
      b.addEventListener('click', () => this.edges.add(b.dataset.key));
    }
    const shoot = document.getElementById('t-shoot');
    shoot.addEventListener('touchstart', (e) => { e.preventDefault(); this.shoot = true; shoot.classList.add('down'); }, { passive: false });
    const up = () => { this.shoot = false; shoot.classList.remove('down'); };
    shoot.addEventListener('touchend', up);
    shoot.addEventListener('touchcancel', up);
  }

  reset() { this.move.end(); this.aim.end(); this.shoot = false; }

  // Move stick: up = camera forward. Aim stick: the direction to point the robot's nose,
  // in the same screen frame (null while released or barely deflected).
  read() {
    const m = this.move, a = this.aim;
    const mag = Math.hypot(m.x, m.y);
    const k = mag < 0.12 ? 0 : Math.min(1, (mag - 0.12) / 0.88) / mag;
    return {
      fx: -m.y * k,
      fy: m.x * k,
      aim: Math.hypot(a.x, a.y) > 0.35 ? [a.x, a.y] : null,
      shoot: this.shoot,
    };
  }
}
