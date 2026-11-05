// One place that pins the three.js build. Imported by path (not the bare 'three' specifier)
// so the same modules also load inside Web Workers, which don't see the page's importmap.
export * from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
