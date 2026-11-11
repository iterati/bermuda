// The one fragment shader, generated once: every module is in it and uniforms pick which runs,
// so changing a scene never recompiles. The levels live in a float texture, one row per level (render.ts packs it).
import {
  LATTICES,
  MAX_DEPTH,
  MAX_STOPS,
  MAX_VARIANTS,
  SHAPES,
  VARIATIONS,
  type LatticeKind,
  type ShapeKind,
  type VariationKind,
} from './scene'

// A level's row, in texels:
//   0 weight, scale, turn, next row (-1 ends the chain)
//   1 offset x, offset y, e2 x, e2 y
//   2 and 3: the weights of VARIATIONS, in order
//   4 cell by (0 none, 1 parity, 2 hash), cell turn, cell phase (radians), variant count
//   5 colour at, colour speed, cell spread, total share
//   6 the level's hash seed (from its id), its far end's in a morph, how far through its window it is, spill
//   7 lattice kind (its index in LATTICES), sectors, jitter, unused
//   8 + 6v: variant v's share, n, m, r
//   9 + 6v: its round, twist, the row its sub-chain starts at (-1: none), kind (SHAPES' index)
//   10 + 6v: its form, corner, onion, join weight (0: no join)
//   11 + 6v: the joined shape's kind, n, m, r
//   12 + 6v: the joined shape's round, twist, form, corner
//   13 + 6v: the join's offset x, offset y, blend, unused
export const VARIANT_TEXELS = 6
export const ROW_TEXELS = 8 + VARIANT_TEXELS * MAX_VARIANTS

// Each variation as GLSL over p, with r2 = |p|², r = |p| and th = atan(x, y) at hand (flam3's forms).
const VARIATION_GLSL: Record<VariationKind, string> = {
  linear: 'p',
  radial: 'p * (exp(min(r, 8.)) - 1.)',
  swirl: 'vec2(p.x * sin(r2) - p.y * cos(r2), p.x * cos(r2) + p.y * sin(r2))',
  spherical: 'p / max(r2, 1e-4)',
  sinusoidal: 'sin(p)',
  polar: 'vec2(th / PI, r - 1.)',
  bubble: 'p * 4. / (r2 + 4.)',
  fisheye: 'p.yx * 2. / (r + 1.)',
}

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
const LATTICE_GLSL = LATTICES.map((kind, i) => {
  const test = i === 0 ? 'if (kind < .5) ' : i < LATTICES.length - 1 ? `else if (kind < ${i}.5) ` : 'else '
  return `  ${test}{ // ${kind}\n    ${LATTICE_BODY[kind]}\n  }`
}).join('\n')
// Each shape as GLSL over p, centred, pointing up and about r across from its middle, with f its form (0 to 1),
// n its whole count and m the star's inner ratio: iq's 2D distance functions, their proportions set from f.
const SHAPE_GLSL: Record<ShapeKind, string> = {
  star: 'sdStar(p, r, n, m)',
  box: 'sdBox(p, r * vec2(1, max(f, .05)))', // f: height to width
  rhombus: 'sdRhombus(p, r * vec2(max(f, .05), 1))', // f: width to height
  triangle: 'sdTriangle(p, vec2(0, r), r * vec2(-mix(.15, 1.6, f), -.5), r * vec2(mix(.15, 1.6, f), -.5))', // f: base
  trapezoid: 'sdTrapezoid(p, r, r * f, .7 * r)', // f: top to bottom
  parallelogram: 'sdParallelogram(p, .6 * r, .6 * r, (2. * f - 1.) * .6 * r)', // f: lean, upright at .5
  capsule: 'sdUnevenCapsule(p + vec2(0, .5 * r), .5 * r, .5 * r * max(f, .05), r)', // f: top to bottom
  pie: 'sdPie(p, vec2(sin(PI * max(f, .01)), cos(PI * max(f, .01))), r)', // f: opening
  arc: 'sdArc(p, vec2(sin(PI * mix(.05, 1., f)), cos(PI * mix(.05, 1., f))), .85 * r, .12 * r)', // f: opening
  horseshoe: 'sdHorseshoe(p, vec2(cos(PI * mix(.05, 1., f)), sin(PI * mix(.05, 1., f))), .65 * r, r * vec2(.35, .12))', // f: opening
  vesica: 'sdVesica(p.yx, r, r * mix(.05, .95, f))', // f: width to height
  moon: 'sdMoon(p.yx, r * mix(.05, 1.2, f), r, .85 * r)', // f: how far the bite is from the middle
  heart: 'sdHeart(p / (1.6 * r) + vec2(0, .55)) * 1.6 * r', // no form
  cross: 'sdCross(p, r * vec2(1, max(f, .05)))', // f: thickness to length
  roundX: 'sdRoundedX(p, 1.41 * r, r * mix(.02, .4, f))', // f: thickness
  blobbyCross: 'sdBlobbyCross(p / r, mix(-.5, .35, f)) * r', // f: from a cushion through a diamond to a 4-point star
  ellipse: 'sdEllipse(p, r * vec2(clamp(f, .05, .97), 1))', // f: width to height
  cutDisk: 'sdCutDisk(p, r, r * mix(-.9, .9, f))', // f: where the cut is
  circleWave: 'sdCircleWave(p, mix(.05, 1., f), .5 * r)', // f: how deep the waves are
  segment: 'length(p - vec2(0, clamp(p.y, -r, r))) - .3 * r * f', // f: thickness
  stairs: 'sdStairs(p + r * vec2(1, mix(.3, 1.7, f)), 2. * r / n * vec2(1, mix(.3, 1.7, f)), n)', // n steps, f: steepness
  coolS: 'sdCoolS(p / r) * r', // no form
}

export function generateShader(): string {
  const shapes = SHAPES.map((kind, i) => `    case ${i}: return ${SHAPE_GLSL[kind]}; // ${kind}`).join('\n')
  const vary = VARIATIONS.map((kind, i) => {
    const w = `${i < 4 ? 'wa' : 'wb'}.${'xyzw'[i % 4]}`
    return `  if (${w} != 0.) q += ${w} * (${VARIATION_GLSL[kind]}); // ${kind}`
  }).join('\n')
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define PI 3.14159265359
#define MAX_DEPTH ${MAX_DEPTH}
#define MAX_VARIANTS ${MAX_VARIANTS}
#define MAX_STOPS ${MAX_STOPS}

uniform vec2 uRes;
uniform vec4 uFrame;              // origin x, origin y, zoom, turn
uniform sampler2D uLevels;        // the level rows
uniform float uDepth;             // the heaviest chain's weight, for depth spreads
uniform vec4 uContour;            // rings, their spread, the running ring phase
uniform vec2 uRadial;             // radial weight, its spread
uniform vec4 uLine;               // kind (LINES' index), width, its spread, units (0 cell to 1 screen)
uniform vec2 uFalloff;            // falloff, its spread
uniform vec4 uDots;               // dot count, its spread, dot size, its spread
uniform vec2 uCrawl;              // the dots' running crawl phase (in dots), the far end's
uniform int uStopCount;
uniform vec4 uStops[MAX_STOPS];   // at, L, C, h
uniform int uStopMix[MAX_STOPS];  // 0 straight, 1 short, 2 long
uniform int uTowardMix[MAX_STOPS]; // the far end's
uniform vec4 uPalette;            // hue, contrast, radius, running index
uniform float uComposite;         // 0 add to 1 first hit
uniform vec4 uToward;             // a morph's far end: its line kind, how far in (0 none), its ring phase, its index
uniform vec2 uTowardRings;        // the far end's rings, their spread
uniform int uAA;
uniform float uGamma;
out vec4 outColor;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec4 row(int j, int k) { return texelFetch(uLevels, ivec2(k, j), 0); }
float hash(vec2 id) { return fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453); }

// iq's sdStar (the first of the shapes below, from his 2D distance functions): n points, m from 1 (a dual star) through 2 (an n-gon) to n (spokes)
float sdStar(vec2 p, float r, float n, float m) {
  m = clamp(m, 1.01, n);
  float an = PI / n, en = PI / m;
  vec2 acs = vec2(cos(an), sin(an)), ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2. * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0., r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}

float dot2(vec2 v) { return dot(v, v); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
float sdRhombus(vec2 p, vec2 b) {
  b.y = -b.y; p = abs(p);
  float h = clamp((dot(b, p) + b.y * b.y) / dot(b, b), 0., 1.);
  p -= b * vec2(h, h - 1.);
  return length(p) * sign(p.x);
}
float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0., 1.);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0., 1.);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0., 1.);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float sdTrapezoid(vec2 p, float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he), k2 = vec2(r2 - r1, 2. * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, p.y < 0. ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot2(k2), 0., 1.);
  float s = cb.x < 0. && ca.y < 0. ? -1. : 1.;
  return s * sqrt(min(dot2(ca), dot2(cb)));
}
float sdParallelogram(vec2 p, float wi, float he, float sk) {
  vec2 e = vec2(sk, he);
  p = p.y < 0. ? -p : p;
  vec2 w = p - e; w.x -= clamp(w.x, -wi, wi);
  vec2 d = vec2(dot(w, w), -w.y);
  float s = p.x * e.y - p.y * e.x;
  p = s < 0. ? -p : p;
  vec2 v = p - vec2(wi, 0); v -= e * clamp(dot(v, e) / dot(e, e), -1., 1.);
  d = min(d, vec2(dot(v, v), wi * he - abs(s)));
  return sqrt(d.x) * sign(-d.y);
}
float sdUnevenCapsule(vec2 p, float r1, float r2, float h) {
  p.x = abs(p.x);
  float b = (r1 - r2) / h, a = sqrt(1. - b * b), k = dot(p, vec2(-b, a));
  if (k < 0.) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}
float sdPie(vec2 p, vec2 c, float r) {
  p.x = abs(p.x);
  float l = length(p) - r, m = length(p - c * clamp(dot(p, c), 0., r));
  return max(l, m * sign(c.y * p.x - c.x * p.y));
}
float sdArc(vec2 p, vec2 sc, float ra, float rb) {
  p.x = abs(p.x);
  return (sc.y * p.x > sc.x * p.y ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
}
float sdHorseshoe(vec2 p, vec2 c, float r, vec2 w) {
  p.x = abs(p.x);
  float l = length(p);
  p = mat2(-c.x, c.y, c.y, c.x) * p;
  p = vec2(p.y > 0. || p.x > 0. ? p.x : l * sign(-c.x), p.x > 0. ? p.y : l);
  p = vec2(p.x, abs(p.y - r)) - w;
  return length(max(p, 0.)) + min(0., max(p.x, p.y));
}
float sdVesica(vec2 p, float w, float h) {
  float d = .5 * (w * w - h * h) / h;
  p = abs(p);
  vec3 c = w * p.y < d * (p.x - w) ? vec3(0, w, 0) : vec3(-d, 0, d + h);
  return length(p - c.yx) - c.z;
}
float sdMoon(vec2 p, float d, float ra, float rb) {
  p.y = abs(p.y);
  float a = (ra * ra - rb * rb + d * d) / (2. * d), b = sqrt(max(ra * ra - a * a, 0.));
  if (d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.)) return length(p - vec2(a, b));
  return max(length(p) - ra, -(length(p - vec2(d, 0)) - rb));
}
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.) return sqrt(dot2(p - vec2(.25, .75))) - sqrt(2.) / 4.;
  return sqrt(min(dot2(p - vec2(0, 1)), dot2(p - .5 * max(p.x + p.y, 0.)))) * sign(p.x - p.y);
}
float sdCross(vec2 p, vec2 b) {
  p = abs(p); p = p.y > p.x ? p.yx : p.xy;
  vec2 q = p - b;
  float k = max(q.y, q.x);
  vec2 w = k > 0. ? q : vec2(b.y - p.x, -k);
  return sign(k) * length(max(w, 0.));
}
float sdRoundedX(vec2 p, float w, float r) { p = abs(p); return length(p - min(p.x + p.y, w) * .5) - r; }
float sdBlobbyCross(vec2 pos, float he) {
  he += he < 0. ? -1e-3 : 1e-3;
  pos = abs(pos);
  pos = vec2(abs(pos.x - pos.y), 1. - pos.x - pos.y) / sqrt(2.);
  float p = (he - pos.y - .25 / he) / (6. * he), q = pos.x / (he * he * 16.), h = q * q - p * p * p, x;
  if (h > 0.) { float r = sqrt(h); x = pow(q + r, 1. / 3.) - pow(abs(q - r), 1. / 3.) * sign(r - q); }
  else { float r = sqrt(p); x = 2. * r * cos(acos(q / (p * r)) / 3.); }
  x = min(x, sqrt(2.) / 2.);
  vec2 z = vec2(x, he * (1. - 2. * x * x)) - pos;
  return length(z) * sign(z.y);
}
float sdEllipse(vec2 p, vec2 ab) {
  p = abs(p);
  if (p.x > p.y) { p = p.yx; ab = ab.yx; }
  float l = ab.y * ab.y - ab.x * ab.x;
  float m = ab.x * p.x / l, m2 = m * m, n = ab.y * p.y / l, n2 = n * n;
  float c = (m2 + n2 - 1.) / 3., c3 = c * c * c;
  float q = c3 + m2 * n2 * 2., d = c3 + m2 * n2, g = m + m * n2, co;
  if (d < 0.) {
    float h = acos(q / c3) / 3., s = cos(h), t = sin(h) * sqrt(3.);
    float rx = sqrt(-c * (s + t + 2.) + m2), ry = sqrt(-c * (s - t + 2.) + m2);
    co = (ry + sign(l) * rx + abs(g) / (rx * ry) - m) / 2.;
  } else {
    float h = 2. * m * n * sqrt(d);
    float s = sign(q + h) * pow(abs(q + h), 1. / 3.), u = sign(q - h) * pow(abs(q - h), 1. / 3.);
    float rx = -s - u - c * 4. + 2. * m2, ry = (s - u) * sqrt(3.), rm = sqrt(rx * rx + ry * ry);
    co = (ry / sqrt(rm - rx) + 2. * g / rm - m) / 2.;
  }
  vec2 r = ab * vec2(co, sqrt(1. - co * co));
  return length(r - p) * sign(p.y - r.y);
}
float sdCutDisk(vec2 p, float r, float h) {
  float w = sqrt(r * r - h * h);
  p.x = abs(p.x);
  float s = max((h - r) * p.x * p.x + w * w * (h + r - 2. * p.y), h * p.x - w * p.y);
  return s < 0. ? length(p) - r : p.x < w ? h - p.y : length(p - vec2(w, h));
}
float sdCircleWave(vec2 p, float tb, float ra) {
  tb = PI * 5. / 6. * max(tb, 1e-4);
  vec2 co = ra * vec2(sin(tb), cos(tb));
  p.x = abs(mod(p.x, co.x * 4.) - co.x * 2.);
  vec2 p1 = p, p2 = vec2(abs(p.x - 2. * co.x), -p.y + 2. * co.y);
  float d1 = co.y * p1.x > co.x * p1.y ? length(p1 - co) : abs(length(p1) - ra);
  float d2 = co.y * p2.x > co.x * p2.y ? length(p2 - co) : abs(length(p2) - ra);
  return min(d1, d2);
}
float sdStairs(vec2 p, vec2 wh, float n) {
  vec2 ba = wh * n;
  float d = min(dot2(p - vec2(clamp(p.x, 0., ba.x), 0)), dot2(p - vec2(ba.x, clamp(p.y, 0., ba.y))));
  float s = sign(max(-p.y, p.x - ba.x)), dia = length(wh);
  p = mat2(wh.x, -wh.y, wh.y, wh.x) * p / dia;
  float id = clamp(round(p.x / dia), 0., n - 1.);
  p.x = p.x - id * dia;
  p = mat2(wh.x, wh.y, -wh.y, wh.x) * p / dia;
  float hh = wh.y / 2.;
  p.y -= hh;
  if (p.y > hh * sign(p.x)) s = 1.;
  p = id < .5 || p.x > 0. ? p : -p;
  d = min(d, dot2(p - vec2(0, clamp(p.y, -hh, hh))));
  d = min(d, dot2(p - vec2(clamp(p.x, 0., wh.x), hh)));
  return sqrt(d) * s;
}
float sdCoolS(vec2 p) {
  float six = p.y < 0. ? -p.x : p.x;
  p.x = abs(p.x); p.y = abs(p.y) - .2;
  float rex = p.x - min(round(p.x / .4), .4), aby = abs(p.y - .2) - .6;
  float d = dot2(vec2(six, -p.y) - clamp(.5 * (six - p.y), 0., .2));
  d = min(d, dot2(vec2(p.x, -aby) - clamp(.5 * (p.x - aby), 0., .4)));
  d = min(d, dot2(vec2(rex, p.y - clamp(p.y, 0., .4))));
  return sqrt(d) * sign(2. * p.x + aby + abs(aby + .4) - .4);
}

// a shape of kind (SHAPES' index) at p, size r, form f, count n and the star's m
float sdKind(float kind, vec2 p, float r, float f, float n, float m) {
  switch (int(kind)) {
${shapes}
  }
  return length(p) - r;
}

// a shape turned by twist: rounded by corner (iq's opRound, shrunk by as much first), then blended into a circle
// by round
float shapeOf(vec2 p, float kind, float n, float m, float r, float circle, float twist, float f, float corner) {
  p = rot(twist) * p;
  float c = min(corner, .9 * r);
  return mix(sdKind(kind, p, r - c, f, n, m) - c, length(p) - r, circle);
}

// iq's quadratic smooth minimum, k wide
float smin(float a, float b, float k) {
  k = max(k, 1e-6) * 4.;
  float h = max(k - abs(a - b), 0.) / k;
  return min(a, b) - h * h * k * .25;
}

// the nearest point of the lattice a(1, 0) + b e2, centre-nested, from the 4 corners of p's parallelogram:
// the local offset and the id (a, b)
vec4 oblique(vec2 p, vec2 e2) {
  vec2 q = vec2(p.x - e2.x * p.y / e2.y, p.y / e2.y);
  vec2 b = floor(q);
  vec4 best = vec4(1e9);
  for (int k = 0; k < 4; k++) {
    vec2 id = b + vec2(k & 1, k >> 1);
    vec2 d = p - (id.x * vec2(1, 0) + id.y * e2);
    if (dot(d, d) < dot(best.xy, best.xy)) best = vec4(d, id);
  }
  return best;
}

// the pad's points each moved inside its own parallelogram by jitter (0 the pad itself, 1 organic cells),
// the nearest of the 5 x 5 round p (a flat, sheared pad's nearest point can sit two rows off)
vec4 voronoi(vec2 p, vec2 e2, float jitter) {
  vec2 q = vec2(p.x - e2.x * p.y / e2.y, p.y / e2.y);
  vec2 b = floor(q + .5);
  vec4 best = vec4(1e9);
  for (int k = 0; k < 25; k++) {
    vec2 id = b + vec2(k % 5 - 2, k / 5 - 2);
    vec2 at = id + jitter * (vec2(hash(id), hash(id + 19.19)) - .5);
    vec2 d = p - (at.x * vec2(1, 0) + at.y * e2);
    if (dot(d, d) < dot(best.xy, best.xy)) best = vec4(d, id);
  }
  return best;
}

vec2 vary(vec2 p, vec4 wa, vec4 wb) {
  float r2 = dot(p, p), r = sqrt(r2), th = atan(p.x, p.y);
  vec2 q = vec2(0);
${vary}
  return q;
}

// A level's lattice: the local offset .xy and the cell id .zw, and k, the cells per unit at p.
// Ids are whole numbers, so parity is (id.x + id.y) mod 2.
vec4 lattice(vec2 p, vec2 e2, vec4 t7, out float k) {
  float kind = t7.x, n = t7.y;
  k = 1.;
${LATTICE_GLSL}
}

vec3 oklabToSrgb(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  vec3 lin = clamp(vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), 0., 1.);
  return mix(12.92 * lin, 1.055 * pow(lin, vec3(1. / 2.4)) - .055, step(.0031308, lin));
}

// a segment f of the way from stop a to stop b, straight through OKLab, or the short or long way round the hue
vec3 segment(vec4 a, vec4 b, float f, int how) {
  float ha = a.w + uPalette.x, hb = b.w + uPalette.x;
  if (how == 0) return mix(vec3(a.y, a.z * cos(ha), a.z * sin(ha)), vec3(b.y, b.z * cos(hb), b.z * sin(hb)), f);
  float dh = mod(hb - ha + PI, 2. * PI) - PI;
  if (how == 2) dh -= sign(dh + 1e-6) * 2. * PI;
  float h = ha + dh * f, c = mix(a.z, b.z, f);
  return vec3(mix(a.y, b.y, f), c * cos(h), c * sin(h));
}

// the palette round its OKLCh stops, each segment mixed its own way (in a morph, blended into the far end's way)
vec3 palette(float t) {
  t = fract(t);
  int k = uStopCount - 1;
  for (int i = 0; i < MAX_STOPS; i++) if (i < uStopCount && uStops[i].x <= t) k = i;
  int k2 = k + 1 >= uStopCount ? 0 : k + 1;
  vec4 a = uStops[k], b = uStops[k2];
  float a1 = k2 <= k ? b.x + 1. : b.x;
  float f = clamp(((t < a.x ? t + 1. : t) - a.x) / max(a1 - a.x, 1e-5), 0., 1.);
  vec3 lab = segment(a, b, f, uStopMix[k]);
  if (uToward.y > 0. && uTowardMix[k] != uStopMix[k]) lab = mix(lab, segment(a, b, f, uTowardMix[k]), uToward.y);
  lab.x = clamp(.5 + (lab.x - .5) * uPalette.y, 0., 1.);
  return oklabToSrgb(lab);
}

// one dotted line of n dots round the cell: dash = (turn round the cell, radius from its middle in line units); each
// dot a dash size of the gap to the next long and w wide, crawled phase dots along
float dotted(float d, vec4 dash, float n, float phase, float w, float f) {
  float gap = 2. * PI * dash.y / n;
  float along = (fract(dash.x * n + phase) - .5) * gap;
  float q = length(vec2(d, max(abs(along) - max(.5 * dash.w * gap - w, 0.), 0.)));
  return pow(1. - smoothstep(0., w, q), f);
}

// a line of kind at distance d from it; dots also take dash (dotted's, with the dot count in z), fading from the whole
// count below to the one above, and their crawl phase
float lineOf(float kind, float d, float w, float f, vec4 dash, float phase) {
  if (kind < .5) return min(pow(w / max(d, 1e-6), f), 8.);
  if (kind < 1.5) return pow(1. - smoothstep(0., w, d), f);
  if (kind < 2.5) return 1. - step(w, d);
  if (kind < 3.5) return 1. - smoothstep(w, w * (1. + f), d);
  float n = max(floor(dash.z), 1.);
  return mix(dotted(d, dash, n, phase, w, f), dotted(d, dash, n + 1., phase, w, f), clamp(dash.z - n, 0., 1.));
}

// a contour's line as kind: the outline, faded by rings from 0 to 1 into echo rings pi/k apart drifting by phase;
// scale takes the distance to the line's units
float contour(float d, float k, float rings, float phase, float kind, float scale, float w, float f, vec4 dash,
              float crawl) {
  float echo = clamp(rings, 0., 1.);
  float a = echo > 0. ? lineOf(kind, abs(sin(d * k + phase)) / k * scale, w, f, dash, crawl) : 0.;
  return echo < 1. ? mix(lineOf(kind, abs(d) * scale, w, f, dash, crawl), a, echo) : a;
}

// What one cell of a level draws: its distance, where it is round the cell's middle (turns) and how far out (rad), its
// parity sign, the variant its hash picks and the seed it picked with.
struct Cell { float d; float turn; float rad; float sgn; int v; float seed; };

// cell id's shape at h (in the cell, turned by the Cell step) on level row j of weight w
Cell cellAt(int j, vec2 h, vec2 id, float w) {
  vec4 t4 = row(j, 4), t5 = row(j, 5), t6 = row(j, 6);
  Cell c;
  // a level whose far end has another id turns each cell over to the far end's seed at the cell's own time,
  // in the middle of the level's window, the cell's shapes dipping into circles as it does
  float over = .3 + .4 * hash(id + 7.7);
  c.seed = t6.z < over ? t6.x : t6.y;
  float dip = t6.x != t6.y ? 1. - smoothstep(0., .08, abs(t6.z - over)) : 0.;
  // the Cell step: parity turns odd cells the other way, hash turns each cell either way (Truchet), and both
  // flip the turned cells' ring phase; a collapsed level does not turn
  c.sgn = (t4.x > 1.5 ? hash(id + c.seed * 5.13 + 7.) : t4.x > .5 ? mod(id.x + id.y, 2.) : 0.) > .5 ? -1. : 1.;
  h = rot(c.sgn * t4.y * w) * h;
  // the per-cell pick among the variants, by share
  float pick = hash(id + c.seed * 17.31) * t5.w, shares = 0.;
  c.v = 0;
  for (int k = 0; k < MAX_VARIANTS; k++) {
    if (float(k) >= t4.w) break;
    c.v = k;
    shares += row(j, 8 + ${VARIANT_TEXELS} * k).x;
    if (pick < shares) break;
  }
  int b = 8 + ${VARIANT_TEXELS} * c.v;
  vec4 s0 = row(j, b), s1 = row(j, b + 1), s2 = row(j, b + 2);
  c.d = shapeOf(h, s1.w, s0.y, s0.z, s0.w, mix(s1.x, 1., dip), s1.y, s2.x, s2.y);
  // the joined shape, smooth-unioned in by its weight
  if (s2.w > 0.) {
    vec4 s3 = row(j, b + 3), s4 = row(j, b + 4), s5 = row(j, b + 5);
    float e = shapeOf(h - s5.xy, s3.x, s3.y, s3.z, s3.w, mix(s4.x, 1., dip), s4.y, s4.z, s4.w);
    c.d = mix(c.d, smin(c.d, e, s5.z), s2.w);
  }
  if (s2.z > 0.) c.d = abs(c.d) - s2.z;
  vec2 q = rot(s1.y) * h;
  c.turn = atan(q.x, q.y) / (2. * PI);
  c.rad = length(q);
  return c;
}

// What a cell's line draws at depth, scale its screen units a cell unit, with the far end's line in a morph mixed in: echo rings 1/rings apart, drifting
// by the ring phase; in a morph the ring count morphs, and each end draws with its own echo, ring phase, line kind
// and crawl, their lines mixed.
float drawn(Cell c, float ringPhase, float depth, float scale) {
  float ra = uContour.x + uContour.y * depth, rb = uTowardRings.x + uTowardRings.y * depth;
  float k = PI * mix(max(ra, 1.), max(rb, 1.), uToward.y);
  float lw = max(uLine.y + uLine.z * depth, 1e-5), lf = uFalloff.x + uFalloff.y * depth;
  vec4 dash = vec4(c.turn, c.rad * scale, max(uDots.x + uDots.y * depth, 1.), clamp(uDots.z + uDots.w * depth, 0., 1.));
  float a = contour(c.d, k, ra, uContour.z + c.sgn * ringPhase, uLine.x, scale, lw, lf, dash, c.sgn * uCrawl.x);
  if (uToward.y > 0.)
    a = mix(a, contour(c.d, k, rb, uToward.z + c.sgn * ringPhase, uToward.x, scale, lw, lf, dash, c.sgn * uCrawl.y),
            uToward.y);
  // in screen units a cell the warps shrink to a few line widths across fades out rather than filling with line
  return a * mix(1., smoothstep(2. * lw, 8. * lw, scale), uLine.w);
}

// how far the variations stretch the plane at q0 (to q): the linear weight's scale alone, else measured
mat2 stretch(vec2 q0, vec2 q, vec4 wa, vec4 wb) {
  if (wa.yzw == vec3(0) && wb == vec4(0)) return mat2(wa.x);
  float e = 1e-3 * max(length(q0), 1e-3);
  return mat2((vary(q0 + vec2(e, 0), wa, wb) - q) / e, (vary(q0 + vec2(0, e), wa, wb) - q) / e);
}

vec3 render(vec2 fc) {
  vec2 p = rot(uFrame.w) * ((fc * 2. - uRes) / uRes.y) / uFrame.z + uFrame.xy;
  float r0 = length(p);
  float ci = uPalette.z * r0;
  vec3 add = vec3(0), first = vec3(0);
  float cover = 0., grown = 0.;
  // how far the chain has stretched the screen at this pixel, for lines in screen units
  mat2 J = rot(uFrame.w) / uFrame.z;
  int j = 0;
  for (int i = 0; i < MAX_DEPTH; i++) {
    if (j < 0) break;
    // a level is as deep as the weight above it, so a level collapsing or growing moves the depths below smoothly
    float depth = grown / uDepth;
    vec4 t0 = row(j, 0), t1 = row(j, 1), t4 = row(j, 4), t5 = row(j, 5), t6 = row(j, 6), t7 = row(j, 7);
    vec4 wa = row(j, 2), wb = row(j, 3);
    float w = t0.x, kc;
    // affine, variations, lattice; the level weight blends the re-tiling toward pass-through
    vec2 q0 = t0.y * (rot(t0.z) * p) + t1.xy, q = vary(q0, wa, wb);
    vec4 cell = lattice(q, t1.zw, t7, kc);
    mat2 Jq = t0.y * rot(t0.z) * J;
    if (uLine.w > 0.) Jq = stretch(q0, q, wa, wb) * Jq;
    J = J * (1. - w) + kc * Jq * w;
    // how many screen units a cell unit spans here
    float px = inversesqrt(max(abs(determinant(J)), 1e-12)), scale = mix(1., px, uLine.w);
    // draw: the cell's shape and line
    Cell own = cellAt(j, mix(p, cell.xy, w), cell.zw, w);
    float a = drawn(own, t4.z, depth, scale);
    // spill: the outlines of the shapes of the cells a step round it, drawn where they reach into this one (the
    // nearest outline, so overlapping shapes each show theirs), faded in by spill; the parse keeps it to lattices
    // whose cells are translates, and triangle steps by half the pad to reach both halves
    Cell near = own;
    vec2 nid = cell.zw;
    if (t6.w > 0.) {
      float st = t7.x == ${LATTICES.indexOf('triangle')}. ? .5 : 1.;
      for (int k = 0; k < 9; k++) {
        if (k == 4) continue;
        vec2 dq = st * (float(k % 3 - 1) * vec2(1, 0) + float(k / 3 - 1) * t1.zw);
        float kn;
        vec4 nc = lattice(q + dq, t1.zw, t7, kn);
        if (nc.zw == cell.zw) continue;
        Cell c = cellAt(j, mix(p, nc.xy - dq, w), nc.zw, w);
        if (abs(c.d) < abs(near.d)) {
          near = c;
          nid = nc.zw;
        }
      }
      a = mix(a, drawn(near, t4.z, depth, scale), t6.w);
    }
    // a level whose cells are under a few pixels fades out rather than shimmer (log-polar's centre)
    a *= exp(-r0 * (uRadial.x + uRadial.y * depth)) * w * smoothstep(1., 3., uRes.y * .5 * px);
    // colour: the ancestry index pulls toward the level's own colour as far as the level is grown, plus a per-cell spread
    ci = mix(ci, t5.x + t5.z * hash(cell.zw + own.seed * 3.7 + 11.), t5.y * w);
    vec3 col = palette(ci + uPalette.w);
    if (uToward.y > 0.) col = mix(col, palette(ci + uToward.w), uToward.y);
    add += col * a;
    float c = clamp(a, 0., 1.);
    first += (1. - cover) * col * c;
    cover += (1. - cover) * c;
    // the chain runs on in this cell, turned by the Cell step
    p = rot(own.sgn * t4.y * w) * mix(p, cell.xy, w);
    grown += w;
    float below = row(j, 9 + ${VARIANT_TEXELS} * own.v).z;
    j = below >= 0. ? int(below) : int(t0.w);
  }
  return mix(add, first, uComposite);
}

void main() {
  vec3 c = vec3(0);
  for (int y = 0; y < 3; y++) for (int x = 0; x < 3; x++)
    if (x < uAA && y < uAA) c += render(gl_FragCoord.xy + (vec2(x, y) + .5) / float(uAA) - .5);
  c /= float(uAA * uAA);
  outColor = vec4(pow(c, vec3(1. / uGamma)), 1.);
}
`
}
