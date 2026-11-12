// Tiling: the lattices beside oblique, the core's, in every program, and spill, the outlines of the shapes of the cells
// round a cell drawn where they reach into it. Its texels are the core's: the lattice's kind, sectors and jitter, and
// spill.
import { allLevels, LATTICES, type LatticeKind } from '../scene'
import { frontDeclared, frontNear, frontOwn, metalFlag, pulled, unpulled } from './deco'
import { cell, kept, kinds, type Engine } from './engine'
import { stretchLine } from './fractal'

// Each lattice kind as GLSL over p, e2, n (sectors) and t7.z (jitter), setting k where its cells are not
// one unit wide. polar and logpolar run the oblique pad over (angle, radius) and (angle, log radius) in
// sectors, x the angle, so (n, 0) is always a lattice vector and the cells close up round the centre;
// their local x is the clockwise tangent and y points outward.
const LATTICE_BODY: Record<LatticeKind, string> = {
  oblique: 'return oblique(p, e2);',
  // rows e2.y high, the odd ones shifted along by e2.x
  brick: `float b = floor(p.y / e2.y + .5), sh = mod(b, 2.) * e2.x, a = floor(p.x - sh + .5);
    return vec4(p - vec2(a + sh, b * e2.y), a, b);`,
  // the pad's parallelograms halved into the triangles between its points: the hex pad's dual; the id
  // keeps the half, t, as its parity
  triangle: `vec2 q = vec2(p.x - e2.x * p.y / e2.y, p.y / e2.y), f = floor(q);
    float t = step(1., q.x - f.x + q.y - f.y);
    vec2 c = f + (1. + t) / 3.;
    return vec4(p - (c.x * vec2(1, 0) + c.y * e2), 2. * f.x + t - f.y, f.y);`,
  polar: `float r = length(p), th = r > 1e-9 ? atan(p.x, p.y) : 0.;
    vec4 c = oblique(vec2(th * n / (2. * PI), r), e2);
    return vec4(c.x * 2. * PI * r / n, c.y, mod(c.z, n), c.w);`,
  logpolar: `float r = max(length(p), 1e-9), th = r > 1e-9 ? atan(p.x, p.y) : 0.;
    vec4 c = oblique(vec2(th, log(r)) * n / (2. * PI), e2);
    k = n / (2. * PI * r);
    return vec4(c.xy, mod(c.z, n), c.w);`,
  // KIFS: mirror both axes, fold into the wedge from 45° to 90°, and shift by e2 (which the hard ranges
  // keep inside it); the id counts the mirrors, so parity is their count mod 2
  fold: `vec2 q = abs(p), s = step(p, vec2(0));
    float sw = step(q.y, q.x);
    if (sw > .5) q = q.yx;
    return vec4(q - e2, s.x + 2. * sw, s.y + sw);`,
  voronoi: 'return voronoi(p, e2, t7.z);',
}

export const tiling: Engine = {
  name: 'tiling',
  parts: [...kinds('lattice', LATTICES), 'spill'],
  needs: (scene, add) => {
    for (const { level } of allLevels(scene.levels)) {
      add(`lattice.${level.lattice.kind}`)
      if (level.cell.spill) add('spill')
    }
  },
  glsl: (has, layout) => {
    // the lattice kinds kept, chained by their index, the last untested
    const lattices = kept(has, 'lattice', LATTICES)
    const latticeChain = lattices
      .map((kind, i) => {
        const at = LATTICES.indexOf(kind) || ''
        const test = i === lattices.length - 1 ? (i ? 'else ' : '') : `${i ? 'else ' : ''}if (kind < ${at}.5) `
        return `  ${test}{ // ${kind}\n    ${LATTICE_BODY[kind]}\n  }`
      })
      .join('\n')
    return {
      ...(has('lattice.voronoi')
        ? {
            afterOblique: `
// pad point id moved inside its own parallelogram by jitter (0 the pad itself, 1 organic cells)
vec2 jittered(vec2 id, float jitter) { return id + jitter * (vec2(hash(id), hash(id + 19.19)) - .5); }

// the pad's points each jittered, the nearest of the 5 x 5 round p (a flat, sheared pad's nearest point can sit
// two rows off)
vec4 voronoi(vec2 p, vec2 e2, float jitter) {
  vec2 q = vec2(p.x - e2.x * p.y / e2.y, p.y / e2.y);
  vec2 b = floor(q + .5);
  vec4 best = vec4(1e9);
  for (int k = 0; k < 25; k++) {
    vec2 id = b + vec2(k % 5 - 2, k / 5 - 2);
    vec2 at = jittered(id, jitter);
    vec2 d = p - (at.x * vec2(1, 0) + at.y * e2);
    if (dot(d, d) < dot(best.xy, best.xy)) best = vec4(d, id);
  }
  return best;
}
`,
          }
        : {}),
      lattice: latticeChain,
      ...(has('spill')
        ? {
            cells: `    bool mirror = t4.x == ${cell('mirror')};
    mat2 Jq = t0.y * rot(t0.z) * J;
${has('stretch') ? '' : metalFlag(layout)}${stretchLine(has)}    vec4 cell;
    vec2 local, nid;
    float px, scale;
    Cell own, near;
${frontDeclared}    // the cell's own shape (k 4, o 0), then, where spill is on, the outlines of the shapes of the cells a step round
    // it, drawn where they reach into this one (the nearest outline, so overlapping shapes each show theirs), faded in
    // by spill: one lattice and one cellAt for all, so each is inlined once. The parse keeps spill to lattices whose
    // cells are translates, triangle steps by half the pad to reach both halves, and voronoi's are its pad's
    // neighbours, each at its own jittered point
    float st = t7.x == ${LATTICES.indexOf('triangle')}. ? .5 : 1.;
    for (int s = 0; s < (t6.w > 0. ? 9 : 1); s++) {
      int k = s == 0 ? 4 : s <= 4 ? s - 1 : s;
      vec2 o = vec2(k % 3 - 1, k / 3 - 1);
      vec4 nc;
      float kn;
${
  has('lattice.voronoi')
    ? `      if (k != 4 && t7.x == ${LATTICES.indexOf('voronoi')}.) {
        vec2 d = jittered(cell.zw + o, t7.z) - jittered(cell.zw, t7.z);
        nc = vec4(cell.xy - d.x * vec2(1, 0) - d.y * t1.zw, cell.zw + o);
      } else {`
    : '      {'
}
        vec2 dq = st * (o.x * vec2(1, 0) + o.y * t1.zw);
${pulled}        // the cell itself at q
        nc = lattice(k == 4 ? q : at, t1.zw, t7, kn);
        if (k != 4) {
${unpulled}        }
      }
      if (k == 4) {
        cell = nc;
        kc = kn;
      } else if (nc.zw == cell.zw) continue;
      Cell c = cellAt(j, mix(p, mirror ? mirrored(nc.xy, nc.zw) : nc.xy, w), nc.zw, w, ringOf(q, nc, t7.x));
      if (k == 4) {
        // the cell's offset, reflected where the Cell step mirrors
        local = mirror ? mirrored(cell.xy, cell.zw) : cell.xy;
        J = J * (1. - w) + kc * Jq * w;
        // how many screen units a cell unit spans here
        px = inversesqrt(max(abs(determinant(J)), 1e-12));
        scale = mix(1., px, uLine.w);
        own = c;
        near = own;
        nid = cell.zw;
${frontOwn(layout)}        continue;
      }
      if (abs(c.d) < abs(near.d)) {
        near = c;
        nid = nc.zw;
      }
${frontNear}    }
    // draw: the cell's line, then, where spill is on, the nearest spilled outline's mixed in by spill, from one drawn
    // call, so it is inlined once
    float a;
    for (int s = 0; s < (t6.w > 0. ? 2 : 1); s++) {
      Cell c = own;
      if (s == 1) c = near;
      float l = drawn(c, t4.z, depth, scale);
      a = s == 0 ? l : mix(a, l, t6.w);
    }
`,
          }
        : {}),
    }
  },
}
