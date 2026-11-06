// Runs whole matches with nothing drawn. The sim modules build their 3D meshes anyway (cheap),
// so give them the one DOM call they make: a canvas for bumper numbers.
globalThis.document = { createElement: () => new OffscreenCanvas(1, 1) };

const THREE = await import('../js/three.js');
const { buildField } = await import('../js/field.js');
const { createWorld, stepWorld, summarize } = await import('../js/sim.js');
const { MatchLog } = await import('../js/log.js');
await import('../js/ai.js');
const DEFAULT_FLAGS = { ...globalThis.AIFLAGS };

const STEP = 1 / 120;
const scene = new THREE.Scene();
const field = buildField(scene);

// Small fast PRNG so a seed replays the same match.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(job) {
  const t0 = performance.now();
  Math.random = mulberry32(job.seed);
  Object.assign(globalThis.AIFLAGS, DEFAULT_FLAGS, job.flags);
  const world = createWorld(scene, field, job.settings, job.playerBot);
  if (job.log) world.log = new MatchLog(world, job.settings);
  const m = world.match;
  while (m.phase !== 'post') stepWorld(world, STEP, null);
  // Let FUEL still in the air land.
  for (let i = 0; i < 360; i++) stepWorld(world, STEP, null);
  const out = { id: job.id, seed: job.seed, ms: Math.round(performance.now() - t0), ...summarize(world), log: world.log ? world.log.text() : null };
  for (const r of world.robots) scene.remove(r.mesh);
  scene.remove(world.fuel.mesh);
  world.fuel.mesh.geometry.dispose();
  return out;
}

self.onmessage = (e) => {
  try { self.postMessage(run(e.data)); }
  catch (err) { self.postMessage({ id: e.data.id, error: String(err && err.stack || err) }); }
};
self.postMessage({ ready: true });
