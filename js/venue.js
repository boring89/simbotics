import * as THREE from './three.js';
import { HL, HW } from './config.js';

// Arena around the field for event matches: bleachers with a crowd, a curtain backdrop and a big
// screen with the event name. Bigger events get bigger stands; Einstein gets the full stadium.
// These are generic arenas, not models of the real venues.

const LEVELS = {
  regional: { rows: 6, len: 22, fill: 0.55, ends: false, drape: 0x1b2440 },
  district: { rows: 5, len: 20, fill: 0.6, ends: false, drape: 0x1d2a2a },
  dcmp: { rows: 9, len: 26, fill: 0.7, ends: false, drape: 0x26213a },
  champs: { rows: 12, len: 30, fill: 0.82, ends: false, drape: 0x14213d },
  einstein: { rows: 16, len: 36, fill: 0.95, ends: true, drape: 0x0c1430 },
};
const SHIRTS = [0xb8323a, 0x2f5fb8, 0xc9a827, 0x2f7e4b, 0xb8661f, 0x5f43a3, 0xd8d8d8, 0x1b1d22, 0x2a2d33, 0x3a3f48, 0x1f8a99, 0x8a2f60];

export function buildVenue(scene) {
  const cache = {};
  let cur = null;
  const screen = makeScreen();

  function make(level) {
    const L = LEVELS[level], g = new THREE.Group();
    const seat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.9 });
    const person = new THREE.BoxGeometry(0.34, 0.5, 0.28);
    const spots = [];
    // One bank of bleachers: rows stepping up and back from the field edge. dir = side it faces.
    const bank = (cx, cz, along, dir) => {
      for (let i = 0; i < L.rows; i++) {
        const y = 0.44 + i * 0.42 + 0.27, off = 1.6 + i * 0.8;   // y: a seated person's centre
        const m = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? L.len : 0.8, 0.44 + i * 0.42, along === 'x' ? 0.8 : L.len * 0.4), seat);
        m.position.set(along === 'x' ? cx : cx + dir * off, (0.44 + i * 0.42) / 2, along === 'x' ? cz + dir * off : cz);
        m.receiveShadow = true;
        g.add(m);
        const n = Math.floor((along === 'x' ? L.len : L.len * 0.4) / 0.55);
        for (let k = 0; k < n; k++) {
          if (Math.random() > L.fill) continue;
          const u = (k - (n - 1) / 2) * 0.55 + (Math.random() - 0.5) * 0.12;
          spots.push(along === 'x' ? [cx + u, y, cz + dir * off] : [cx + dir * off, y, cz + u]);
        }
      }
    };
    // Stands on the far side only: the broadcast camera and the scoring table sit on the near side.
    bank(0, -HW, 'x', -1);
    if (L.ends) { bank(HL + 2.6, 0, 'z', 1); bank(-HL - 2.6, 0, 'z', -1); }
    const crowd = new THREE.InstancedMesh(person, new THREE.MeshStandardMaterial({ roughness: 0.8 }), spots.length);
    const mtx = new THREE.Matrix4(), col = new THREE.Color();
    spots.forEach(([x, y, z], i) => {
      mtx.makeTranslation(x, y, z);
      crowd.setMatrixAt(i, mtx);
      crowd.setColorAt(i, col.setHex(SHIRTS[Math.floor(Math.random() * SHIRTS.length)]));
    });
    g.add(crowd);
    // Curtains behind the stands and the alliance stations.
    const drape = new THREE.MeshStandardMaterial({ color: L.drape, roughness: 1 });
    const back = 1.6 + L.rows * 0.8 + 0.6, hgt = 1.5 + L.rows * 0.42 + 2;
    for (const s of [-1, 1]) {
      const wh = s < 0 ? hgt : 2.4;
      const w = new THREE.Mesh(new THREE.BoxGeometry(L.len + 6, wh, 0.1), drape);
      w.position.set(0, wh / 2, s < 0 ? -(HW + back) : HW + 4.5);
      g.add(w);
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, hgt, 2 * (HW + back)), drape);
      e.position.set(s * (HL + (L.ends ? back + 2.6 : 5)), hgt / 2, 0);
      g.add(e);
    }
    // Light trusses over the field.
    const truss = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 1.2 });
    for (const x of [-6, 0, 6]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2 * HW + 4), truss);
      t.position.set(x, 14, 0);   // above the broadcast camera
      g.add(t);
      for (const z of [-3, -1, 1, 3]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.35), glow);
        l.position.set(x, 13.8, z);
        g.add(l);
      }
    }
    // Scoring table on the near side.
    const table = new THREE.Mesh(new THREE.BoxGeometry(4, 0.75, 0.8), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }));
    table.position.set(0, 0.375, HW + 1.6);
    g.add(table);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(4.02, 0.4, 0.02), new THREE.MeshStandardMaterial({ color: 0xf6d31c, emissive: 0x3a3000 }));
    skirt.position.set(0, 0.45, HW + 1.19);
    g.add(skirt);
    g.userData.screenY = Math.min(hgt - 1.6, 3.4 + L.rows * 0.2);
    g.userData.screenZ = -(HW + back - 0.2);
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    g.visible = false;
    scene.add(g);
    return g;
  }

  return {
    // level: a LEVELS key, or null for no arena.
    set(level, title = '') {
      if (cur) cur.visible = false;
      cur = null;
      if (!level || !LEVELS[level]) { screen.mesh.visible = false; return; }
      cur = cache[level] ??= make(level);
      cur.visible = true;
      screen.draw(title, level === 'einstein' ? 'Einstein' : '');
      screen.mesh.position.set(0, cur.userData.screenY, cur.userData.screenZ);
      screen.mesh.visible = true;
      if (screen.mesh.parent !== scene) scene.add(screen.mesh);
    },
  };
}

function makeScreen() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 384;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.visible = false;
  return {
    mesh,
    draw(title, sub) {
      const x = cv.getContext('2d');
      x.fillStyle = '#0b0f1a'; x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = '#f6d31c'; x.fillRect(0, cv.height - 18, cv.width, 18);
      x.fillStyle = '#fff'; x.textAlign = 'center';
      x.font = 'bold 54px system-ui, sans-serif';
      x.fillText(title.length > 34 ? `${title.slice(0, 33)}…` : title, cv.width / 2, 160);
      x.font = '40px system-ui, sans-serif'; x.fillStyle = '#9fb3d9';
      x.fillText(sub || 'REBUILT · 2026', cv.width / 2, 250);
      tex.needsUpdate = true;
    },
  };
}
