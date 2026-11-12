// The fragment shader, generated from a set of parts: the core is in every program, and each part (a variation,
// shape or lattice kind, or a feature such as spill, the morph or the fills) only in the programs given it, while
// uniforms pick what runs, so changing a scene's values never needs another program. needs gives the parts a scene,
// or a morph between two, draws with, by what it holds and never by its values. The levels live in a float texture,
// one row per level, laid out alike for every program (render.ts packs it).
import {
  allLevels,
  CELLS,
  LATTICES,
  MAX_DEPTH,
  MAX_STOPS,
  MAX_VARIANTS,
  SHAPES,
  VARIATIONS,
  type LatticeKind,
  type Scene,
  type ShapeKind,
  type VariationKind,
} from './scene'

// A level's row, in texels:
//   0 weight, scale, turn, next row (-1 ends the chain)
//   1 offset x, offset y, e2 x, e2 y
//   2 and 3: the weights of VARIATIONS' first eight, in order
//   4 cell by (CELLS' index), cell turn, cell phase (radians), variant count
//   5 colour at, colour speed, cell spread, total share
//   6 the level's hash seed (from its id), its far end's in a morph, how far through its window it is, spill
//   7 lattice kind (its index in LATTICES), sectors, jitter, 1 if no variation but linear has weight
//   8 + 6v: variant v's share, n, m, r
//   9 + 6v: its round, twist, the row its sub-chain starts at (-1: none), kind (SHAPES' index)
//   10 + 6v: its form, corner, onion, join weight (0: no join)
//   11 + 6v: the joined shape's kind, n, m, r
//   12 + 6v: the joined shape's round, twist, form, corner
//   13 + 6v: the join's offset x, offset y, blend, unused
//   VARY_TEXEL on: the weights of the rest of VARIATIONS, four a texel, in order
//   FILL_TEXEL: the fill's amount, line, tone, bands (a level without a fill: 0, 1, 0, 0)
//   FILL_TEXEL + 1: its step, metal, light (radians), shade
//   FILL_TEXEL + 2: its ramp, alternate, front order (0 or 1), unused
export const VARIANT_TEXELS = 6
export const VARY_TEXEL = 8 + VARIANT_TEXELS * MAX_VARIANTS
export const FILL_TEXEL = VARY_TEXEL + Math.ceil((VARIATIONS.length - 8) / 4)
export const ROW_TEXELS = FILL_TEXEL + 3

// Each variation as GLSL over p, with r2 = |p|², r = |p|, th = atan(x, y) (flam3's angle, from the y axis),
// sc = (x, y) / r (flam3's sina and cosa), ph = atan(y, x), pc = p held to ±4 and w its weight at hand: flam3's
// forms, with each pole and overflow held finite (inv, ch, sh; sec, csc, sech and csch take pc on both sides of
// their fraction, so they decay as they should).
const VARIATION_GLSL: Record<VariationKind, string> = {
  linear: 'p',
  radial: 'p * (exp(min(r, 8.)) - 1.)',
  swirl: 'vec2(p.x * sin(r2) - p.y * cos(r2), p.x * cos(r2) + p.y * sin(r2))',
  spherical: 'p / max(r2, 1e-4)',
  sinusoidal: 'sin(p)',
  polar: 'vec2(th / PI, r - 1.)',
  bubble: 'p * 4. / (r2 + 4.)',
  fisheye: 'p.yx * 2. / (r + 1.)',
  horseshoe: 'vec2((p.x - p.y) * (p.x + p.y), 2. * p.x * p.y) / max(r, 1e-6)',
  handkerchief: 'r * vec2(sin(th + r), cos(th - r))',
  heart: 'r * vec2(sin(th * r), -cos(th * r))',
  disc: 'th / PI * vec2(sin(PI * r), cos(PI * r))',
  spiral: 'vec2(sc.y + sin(r), sc.x - cos(r)) / max(r, 1e-6)',
  hyperbolic: 'vec2(sc.x / max(r, 1e-6), sc.y * r)',
  diamond: 'vec2(sc.x * cos(r), sc.y * sin(r))',
  ex: 'ex(r, th)',
  // one of flam3's two roots, so it seams along its cut where the cells are not point-symmetric
  julia: 'sqrt(r) * vec2(cos(.5 * ph), sin(.5 * ph))',
  bent: 'vec2(p.x < 0. ? 2. * p.x : p.x, p.y < 0. ? .5 * p.y : p.y)',
  exponential: 'exp(min(p.x - 1., 8.)) * vec2(cos(PI * p.y), sin(PI * p.y))',
  power: 'pow(max(r, 1e-6), sc.x) * sc.yx',
  cosine: 'vec2(cos(PI * p.x) * ch(p.y), -sin(PI * p.x) * sh(p.y))',
  eyefish: 'p * 2. / (r + 1.)',
  cylinder: 'vec2(sin(p.x), p.y)',
  tangent: 'vec2(sin(p.x), sin(p.y)) * inv(cos(p.y))',
  secant2: 'vec2(p.x, inv(cos(w * r)) - sign(cos(w * r)))',
  cross: 'p * inversesqrt((p.x * p.x - p.y * p.y) * (p.x * p.x - p.y * p.y) + 1e-8)',
  butterfly: '1.30294003 * sqrt(abs(p.x * p.y) / (1e-9 + p.x * p.x + 4. * p.y * p.y)) * vec2(p.x, 2. * p.y)',
  edisc: 'edisc(p, r2)',
  elliptic: 'elliptic(p, r2)',
  foci: 'foci(p)',
  loonie: 'r2 < w * w ? p * sqrt(max(w * w / max(r2, 1e-8) - 1., 0.)) : p',
  polar2: 'vec2(th, .5 * log(max(r2, 1e-12))) / PI',
  scry: 'p * inv(max(r, 1e-4) * (w * r2 + 1.))',
  exp: 'exp(min(p.x, 8.)) * vec2(cos(p.y), sin(p.y))',
  log: 'vec2(.5 * log(max(r2, 1e-12)), ph)',
  sin: 'vec2(sin(p.x) * ch(p.y), cos(p.x) * sh(p.y))',
  cos: 'vec2(cos(p.x) * ch(p.y), -sin(p.x) * sh(p.y))',
  tan: 'vec2(sin(2. * p.x), sh(2. * p.y)) * inv(cos(2. * p.x) + ch(2. * p.y))',
  sec: '2. * vec2(cos(p.x) * cosh(pc.y), sin(p.x) * sinh(pc.y)) * inv(cos(2. * p.x) + cosh(2. * pc.y))',
  csc: '2. * vec2(sin(p.x) * cosh(pc.y), -cos(p.x) * sinh(pc.y)) * inv(cosh(2. * pc.y) - cos(2. * p.x))',
  cot: 'vec2(sin(2. * p.x), -sh(2. * p.y)) * inv(ch(2. * p.y) - cos(2. * p.x))',
  sinh: 'vec2(sh(p.x) * cos(p.y), ch(p.x) * sin(p.y))',
  cosh: 'vec2(ch(p.x) * cos(p.y), sh(p.x) * sin(p.y))',
  tanh: 'vec2(sh(2. * p.x), sin(2. * p.y)) * inv(cos(2. * p.y) + ch(2. * p.x))',
  sech: '2. * vec2(cos(p.y) * cosh(pc.x), -sin(p.y) * sinh(pc.x)) * inv(cos(2. * p.y) + cosh(2. * pc.x))',
  csch: '2. * vec2(sinh(pc.x) * cos(p.y), -cosh(pc.x) * sin(p.y)) * inv(cosh(2. * pc.x) - cos(2. * p.y))',
  coth: 'vec2(sh(2. * p.x), sin(2. * p.y)) * inv(ch(2. * p.x) - cos(2. * p.y))',
}
// flam3's ex, edisc, elliptic and foci, which take more than one line
const VARIATION_FUNCTIONS: Partial<Record<VariationKind, string>> = {
  ex: `vec2 ex(float r, float th) {
  float a = sin(th + r), b = cos(th - r);
  a *= a * a * r;
  b *= b * b * r;
  return vec2(a + b, a - b);
}`,
  edisc: `vec2 edisc(vec2 p, float r2) {
  float xmax = .5 * (sqrt(max(r2 + 1. + 2. * p.x, 0.)) + sqrt(max(r2 + 1. - 2. * p.x, 0.)));
  float a1 = log(xmax + sqrt(max(xmax - 1., 0.))), a2 = -acos(clamp(p.x / xmax, -1., 1.));
  return vec2(cosh(a2) * cos(a1), sinh(a2) * (p.y > 0. ? -sin(a1) : sin(a1))) / 11.57034632;
}`,
  elliptic: `vec2 elliptic(vec2 p, float r2) {
  float xmax = .5 * (sqrt(max(r2 + 1. + 2. * p.x, 0.)) + sqrt(max(r2 + 1. - 2. * p.x, 0.)));
  float a = p.x / xmax, l = log(xmax + sqrt(max(xmax - 1., 0.)));
  return vec2(atan(a, sqrt(max(1. - a * a, 0.))), p.y > 0. ? l : -l) / (.5 * PI);
}`,
  foci: `vec2 foci(vec2 p) {
  float e = .5 * exp(clamp(p.x, -8., 8.)), en = .25 / e;
  return vec2(e - en, sin(p.y)) * inv(e + en - cos(p.y));
}`,
}
// the texel and component a variation's weight sits in (the layout above)
const weightAt = (i: number) => (i < 8 ? [2 + (i >> 2), i & 3] : [VARY_TEXEL + ((i - 8) >> 2), (i - 8) & 3])

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
  ziggurat: 'sdZiggurat(p, r, n, f)', // n steps, f: steepness
}

// Each shape's function, where SHAPE_GLSL's line calls one of its own (sdStar and dot2, which several build on, are
// in every program; sdZiggurat builds on sdBox)
const SHAPE_FUNCTIONS: Partial<Record<ShapeKind, string>> = {
  box: `float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }`,
  rhombus: `float sdRhombus(vec2 p, vec2 b) {
  b.y = -b.y; p = abs(p);
  float h = clamp((dot(b, p) + b.y * b.y) / dot(b, b), 0., 1.);
  p -= b * vec2(h, h - 1.);
  return length(p) * sign(p.x);
}`,
  triangle: `float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
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
}`,
  trapezoid: `float sdTrapezoid(vec2 p, float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he), k2 = vec2(r2 - r1, 2. * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, p.y < 0. ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot2(k2), 0., 1.);
  float s = cb.x < 0. && ca.y < 0. ? -1. : 1.;
  return s * sqrt(min(dot2(ca), dot2(cb)));
}`,
  parallelogram: `float sdParallelogram(vec2 p, float wi, float he, float sk) {
  vec2 e = vec2(sk, he);
  p = p.y < 0. ? -p : p;
  vec2 w = p - e; w.x -= clamp(w.x, -wi, wi);
  vec2 d = vec2(dot(w, w), -w.y);
  float s = p.x * e.y - p.y * e.x;
  p = s < 0. ? -p : p;
  vec2 v = p - vec2(wi, 0); v -= e * clamp(dot(v, e) / dot(e, e), -1., 1.);
  d = min(d, vec2(dot(v, v), wi * he - abs(s)));
  return sqrt(d.x) * sign(-d.y);
}`,
  capsule: `float sdUnevenCapsule(vec2 p, float r1, float r2, float h) {
  p.x = abs(p.x);
  float b = (r1 - r2) / h, a = sqrt(1. - b * b), k = dot(p, vec2(-b, a));
  if (k < 0.) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}`,
  pie: `float sdPie(vec2 p, vec2 c, float r) {
  p.x = abs(p.x);
  float l = length(p) - r, m = length(p - c * clamp(dot(p, c), 0., r));
  return max(l, m * sign(c.y * p.x - c.x * p.y));
}`,
  arc: `float sdArc(vec2 p, vec2 sc, float ra, float rb) {
  p.x = abs(p.x);
  return (sc.y * p.x > sc.x * p.y ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
}`,
  horseshoe: `float sdHorseshoe(vec2 p, vec2 c, float r, vec2 w) {
  p.x = abs(p.x);
  float l = length(p);
  p = mat2(-c.x, c.y, c.y, c.x) * p;
  p = vec2(p.y > 0. || p.x > 0. ? p.x : l * sign(-c.x), p.x > 0. ? p.y : l);
  p = vec2(p.x, abs(p.y - r)) - w;
  return length(max(p, 0.)) + min(0., max(p.x, p.y));
}`,
  vesica: `float sdVesica(vec2 p, float w, float h) {
  float d = .5 * (w * w - h * h) / h;
  p = abs(p);
  vec3 c = w * p.y < d * (p.x - w) ? vec3(0, w, 0) : vec3(-d, 0, d + h);
  return length(p - c.yx) - c.z;
}`,
  moon: `float sdMoon(vec2 p, float d, float ra, float rb) {
  p.y = abs(p.y);
  float a = (ra * ra - rb * rb + d * d) / (2. * d), b = sqrt(max(ra * ra - a * a, 0.));
  if (d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.)) return length(p - vec2(a, b));
  return max(length(p) - ra, -(length(p - vec2(d, 0)) - rb));
}`,
  heart: `float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.) return sqrt(dot2(p - vec2(.25, .75))) - sqrt(2.) / 4.;
  return sqrt(min(dot2(p - vec2(0, 1)), dot2(p - .5 * max(p.x + p.y, 0.)))) * sign(p.x - p.y);
}`,
  cross: `float sdCross(vec2 p, vec2 b) {
  p = abs(p); p = p.y > p.x ? p.yx : p.xy;
  vec2 q = p - b;
  float k = max(q.y, q.x);
  vec2 w = k > 0. ? q : vec2(b.y - p.x, -k);
  return sign(k) * length(max(w, 0.));
}`,
  roundX: `float sdRoundedX(vec2 p, float w, float r) { p = abs(p); return length(p - min(p.x + p.y, w) * .5) - r; }`,
  blobbyCross: `float sdBlobbyCross(vec2 pos, float he) {
  he += he < 0. ? -1e-3 : 1e-3;
  pos = abs(pos);
  pos = vec2(abs(pos.x - pos.y), 1. - pos.x - pos.y) / sqrt(2.);
  float p = (he - pos.y - .25 / he) / (6. * he), q = pos.x / (he * he * 16.), h = q * q - p * p * p, x;
  if (h > 0.) { float r = sqrt(h); x = pow(q + r, 1. / 3.) - pow(abs(q - r), 1. / 3.) * sign(r - q); }
  else { float r = sqrt(p); x = 2. * r * cos(acos(q / (p * r)) / 3.); }
  x = min(x, sqrt(2.) / 2.);
  vec2 z = vec2(x, he * (1. - 2. * x * x)) - pos;
  return length(z) * sign(z.y);
}`,
  ellipse: `float sdEllipse(vec2 p, vec2 ab) {
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
}`,
  cutDisk: `float sdCutDisk(vec2 p, float r, float h) {
  float w = sqrt(r * r - h * h);
  p.x = abs(p.x);
  float s = max((h - r) * p.x * p.x + w * w * (h + r - 2. * p.y), h * p.x - w * p.y);
  return s < 0. ? length(p) - r : p.x < w ? h - p.y : length(p - vec2(w, h));
}`,
  circleWave: `float sdCircleWave(vec2 p, float tb, float ra) {
  tb = PI * 5. / 6. * max(tb, 1e-4);
  vec2 co = ra * vec2(sin(tb), cos(tb));
  p.x = abs(mod(p.x, co.x * 4.) - co.x * 2.);
  vec2 p1 = p, p2 = vec2(abs(p.x - 2. * co.x), -p.y + 2. * co.y);
  float d1 = co.y * p1.x > co.x * p1.y ? length(p1 - co) : abs(length(p1) - ra);
  float d2 = co.y * p2.x > co.x * p2.y ? length(p2 - co) : abs(length(p2) - ra);
  return min(d1, d2);
}`,
  stairs: `float sdStairs(vec2 p, vec2 wh, float n) {
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
}`,
  coolS: `float sdCoolS(vec2 p) {
  float six = p.y < 0. ? -p.x : p.x;
  p.x = abs(p.x); p.y = abs(p.y) - .2;
  float rex = p.x - min(round(p.x / .4), .4), aby = abs(p.y - .2) - .6;
  float d = dot2(vec2(six, -p.y) - clamp(.5 * (six - p.y), 0., .2));
  d = min(d, dot2(vec2(p.x, -aby) - clamp(.5 * (p.x - aby), 0., .4)));
  d = min(d, dot2(vec2(rex, p.y - clamp(p.y, 0., .4))));
  return sqrt(d) * sign(2. * p.x + aby + abs(aby + .4) - .4);
}`,
  ziggurat: `// a side-on ziggurat: n boxes on one base 2r wide, each a step narrower and higher, the whole mix(.4, 1, f) of
// its base high; their union, so a fill's bands run inside it as stacked steps
float sdZiggurat(vec2 p, float r, float n, float f) {
  float H = 2. * r * mix(.4, 1., f), h = H / n, d = 1e9;
  for (int k = 0; k < 16; k++) {
    if (float(k) >= n) break;
    float hk = .5 * (float(k) + 1.) * h;
    d = min(d, sdBox(p - vec2(0, -.5 * H + hk), vec2(r * (1. - float(k) / n), hk)));
  }
  return d;
}`,
}

// A part of the shader beside its core, which every program holds: each variation, shape and lattice kind but the
// first of its list (linear, star and oblique are the core's), screen lines' stretch, the joined shape, spill, dots,
// the soak, the morph's far end and lone-level crossfade, and Deco's fills and their metal (which brings the fills).
export type Part =
  | `variation.${Exclude<VariationKind, 'linear'>}`
  | 'stretch'
  | `shape.${Exclude<ShapeKind, 'star'>}`
  | 'join'
  | `lattice.${Exclude<LatticeKind, 'oblique'>}`
  | 'spill'
  | 'dots'
  | 'soak'
  | 'morph'
  | 'fill'
  | 'metal'
const kinds = (family: string, list: readonly string[]) => list.slice(1).map((kind) => `${family}.${kind}` as Part)
export const PARTS: readonly Part[] = [
  ...kinds('variation', VARIATIONS),
  'stretch',
  ...kinds('shape', SHAPES),
  'join',
  ...kinds('lattice', LATTICES),
  'spill',
  'dots',
  'soak',
  'morph',
  'fill',
  'metal',
]

// The parts a scene draws with, sub-chains included, or a morph between two: both ends' and the morph's, as a
// morph's scene grows what one end lacks from what draws as none. Each is there by what the scene holds, never by a
// value, so no modulator, macro, preset or dice needs another program: a fill brings metal even at metal 0, and
// metal the stretch, as metal reads its slope on the screen.
export function needs(a: Scene, b?: Scene): Set<Part> {
  if (b) return new Set([...needs(a), ...needs(b), 'morph'])
  const parts = new Set<Part>()
  const add = (part: string) => {
    if ((PARTS as readonly string[]).includes(part)) parts.add(part as Part)
  }
  for (const { level } of allLevels(a.levels)) {
    level.variations.forEach(({ kind }) => add(`variation.${kind}`))
    for (const { shape } of level.variants) {
      add(`shape.${shape.kind ?? 'star'}`)
      if (!shape.join) continue
      add('join')
      add(`shape.${shape.join.shape.kind ?? 'star'}`)
    }
    add(`lattice.${level.lattice.kind}`)
    if (level.cell.spill) add('spill')
    if (level.fill) {
      add('fill')
      add('metal')
    }
  }
  if (a.line.kind === 'dots' || a.line.dots) add('dots')
  if (a.background?.kind === 'soak') add('soak')
  if (a.line.units === 'screen' || parts.has('metal')) add('stretch')
  return parts
}

// The shader of the core and the parts given, every part's by default. Fills and metal keep the preprocessor's FILL
// and METAL (METAL brings FILL); a kind or feature left out leaves the rest of the core's text as it is.
export function generateShader(parts: Iterable<Part> = PARTS): string {
  const on = new Set(parts)
  const has = (part: string) => on.has(part as Part)
  const kept = <K extends string>(family: string, list: readonly K[]) =>
    list.filter((kind, i) => i === 0 || has(`${family}.${kind}`))
  const shapeKinds = kept('shape', SHAPES)
  const shapes = shapeKinds
    .map((kind) => `    case ${SHAPES.indexOf(kind)}: return ${SHAPE_GLSL[kind]}; // ${kind}`)
    .join('\n')
  const shapeFunctions = SHAPES.filter((kind) => shapeKinds.includes(kind) || (kind === 'box' && has('shape.ziggurat')))
    .flatMap((kind) => SHAPE_FUNCTIONS[kind] ?? [])
    .join('\n')
  // each texel's four weights, skipped whole where all are 0, and left out where none of its kinds is kept
  const variations = new Set(kept('variation', VARIATIONS))
  const texels = [...new Set(VARIATIONS.map((_, i) => weightAt(i)[0]))]
  const vary = texels
    .flatMap((texel) => {
      const lines = VARIATIONS.flatMap((kind, i) => {
        const [at, c] = weightAt(i)
        const w = `g.${'xyzw'[c]}`
        return at === texel && variations.has(kind)
          ? [`    if (${w} != 0.) { float w = ${w}; q += w * (${VARIATION_GLSL[kind]}); } // ${kind}`]
          : []
      })
      return lines.length ? [`  g = row(j, ${texel});\n  if (g != vec4(0)) {\n${lines.join('\n')}\n  }`] : []
    })
    .join('\n')
  const varyFunctions = [...variations].flatMap((kind) => VARIATION_FUNCTIONS[kind] ?? [])
  // the lattice kinds kept, chained by their index, the last untested
  const lattices = kept('lattice', LATTICES)
  const latticeChain = lattices
    .map((kind, i) => {
      const at = LATTICES.indexOf(kind) || ''
      const test = i === lattices.length - 1 ? (i ? 'else ' : '') : `${i ? 'else ' : ''}if (kind < ${at}.5) `
      return `  ${test}{ // ${kind}\n    ${LATTICE_BODY[kind]}\n  }`
    })
    .join('\n')
  const cell = (by: (typeof CELLS)[number]) => `${CELLS.indexOf(by)}.`
  const lattice = (kind: LatticeKind) => `${LATTICES.indexOf(kind)}.`
  // metal's flag, ahead of the level's vary where the stretch is, as it picks how many points vary takes
  const metalFlag = `#ifdef METAL
    // metal reads its slope on the screen, so it measures the stretch as lines in screen units do
    bool metal = f0.x > 0. && row(j, ${FILL_TEXEL} + 1).y > 0.;
#else
    bool metal = false;
#endif
`
  const stretchLine = has('stretch') ? '    if (measured) Jq = stretch(q, qx, qy, e, j) * Jq;\n' : ''
  return `#version 300 es
${has('metal') ? '#define METAL\n' : has('fill') ? '#define FILL\n' : ''}#ifdef METAL
#define FILL
#endif
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
uniform vec2 uTrap;               // the orbit trap's weight, its circle's size
uniform vec4 uField;              // the colour field: kind (FIELDS' index), angle (radians), scale, depth
uniform vec4 uFieldC;             // its centre x, centre y, steps (0 smooth), at cells (0 or 1)
uniform float uComposite;         // 0 add to 1 first hit
uniform vec4 uToward;             // a morph's far end: its line kind, how far in (0 none), its ring phase, its index
uniform vec2 uTowardRings;        // the far end's rings, their spread
uniform vec2 uCross;              // a lone level's swap: the row its other switches' chain starts at, how far in
uniform vec4 uBg;                 // kind (0 none, 1 flat, 2 gradient, 3 soak), amount, turn (radians), pool size
uniform vec4 uBgSoak;             // at[0], at[1], edge, seep
uniform int uAA;
uniform float uGamma;
out vec4 outColor;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec4 row(int j, int k) { return texelFetch(uLevels, ivec2(k, j), 0); }
float hash(vec2 id) { return fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453); }
// 1 / x held to 1e4 in size, and cosh and sinh held to their value at 8, so the variations' poles stay finite
float inv(float x) { return 1. / (abs(x) < 1e-4 ? (x < 0. ? -1e-4 : 1e-4) : x); }
float ch(float x) { return cosh(clamp(x, -8., 8.)); }
float sh(float x) { return sinh(clamp(x, -8., 8.)); }

// iq's sdStar (the first of the shapes below, from his 2D distance functions): n points, m from 1 (a dual star)
// through 2 (an n-gon) to n (spokes)
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
${shapeFunctions}

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

${
  has('join')
    ? `// iq's quadratic smooth minimum, k wide
float smin(float a, float b, float k) {
  k = max(k, 1e-6) * 4.;
  float h = max(k - abs(a - b), 0.) / k;
  return min(a, b) - h * h * k * .25;
}

`
    : ''
}// the nearest point of the lattice a(1, 0) + b e2, centre-nested, from the 4 corners of p's parallelogram:
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
${
  has('lattice.voronoi')
    ? `
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
`
    : ''
}
${
  varyFunctions.length
    ? `// flam3's ex, edisc, elliptic and foci, which take more than one line
${varyFunctions.join('\n')}

`
    : ''
}// level row j's weighted sum of variations at p, held inside 1e5 either way
vec2 vary(vec2 p, int j) {
  if (row(j, 7).w > .5) return row(j, 2).x * p;
  float r2 = dot(p, p), r = sqrt(r2), th = atan(p.x, p.y);
  float ph = r > 1e-9 ? atan(p.y, p.x) : 0.;
  vec2 sc = p / max(r, 1e-9), pc = clamp(p, -4., 4.), q = vec2(0);
  vec4 g;
${vary}
  return clamp(q, vec2(-1e5), vec2(1e5));
}

// A level's lattice: the local offset .xy and the cell id .zw, and k, the cells per unit at p.
// Ids are whole numbers, so parity is (id.x + id.y) mod 2.
vec4 lattice(vec2 p, vec2 e2, vec4 t7, out float k) {
  float kind = t7.x, n = t7.y;
  k = 1.;
${latticeChain}
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
${
  has('morph')
    ? `  if (uToward.y > 0. && uTowardMix[k] != uStopMix[k]) lab = mix(lab, segment(a, b, f, uTowardMix[k]), uToward.y);
`
    : ''
}  lab.x = clamp(.5 + (lab.x - .5) * uPalette.y, 0., 1.);
  return oklabToSrgb(lab);
}

${
  has('dots')
    ? `// one dotted line of n dots round the cell: dash = (turn round the cell, radius from its middle in line units); each
// dot a dash size of the gap to the next long and w wide, crawled phase dots along
float dotted(float d, vec4 dash, float n, float phase, float w, float f) {
  float gap = 2. * PI * dash.y / n;
  float along = (fract(dash.x * n + phase) - .5) * gap;
  float q = length(vec2(d, max(abs(along) - max(.5 * dash.w * gap - w, 0.), 0.)));
  return pow(1. - smoothstep(0., w, q), f);
}

`
    : ''
}// a line of kind at distance d from it; dots also take dash (dotted's, with the dot count in z), fading from the whole
// count below to the one above, and their crawl phase
float lineOf(float kind, float d, float w, float f, vec4 dash, float phase) {
  if (kind < .5) return min(pow(w / max(d, 1e-6), f), 8.);
  if (kind < 1.5) return pow(1. - smoothstep(0., w, d), f);
  if (kind < 2.5) return 1. - step(w, d);
${
  has('dots')
    ? `  if (kind < 3.5) return 1. - smoothstep(w, w * (1. + f), d);
  float n = max(floor(dash.z), 1.);
  return mix(dotted(d, dash, n, phase, w, f), dotted(d, dash, n + 1., phase, w, f), clamp(dash.z - n, 0., 1.));`
    : '  return 1. - smoothstep(w, w * (1. + f), d);'
}
}

// a contour's line as kind: the outline, faded by rings from 0 to 1 into echo rings pi/k apart drifting by phase;
// scale takes the distance to the line's units
float contour(float d, float k, float rings, float phase, float kind, float scale, float w, float f, vec4 dash,
              float crawl) {
  float echo = clamp(rings, 0., 1.);
  float a = echo > 0. ? lineOf(kind, abs(sin(d * k + phase)) / k * scale, w, f, dash, crawl) : 0.;
  return echo < 1. ? mix(lineOf(kind, abs(d) * scale, w, f, dash, crawl), a, echo) : a;
}

// value noise on hash's lattice, and 5 octaves of it
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + 1.), u.x), u.y);
}
${
  has('soak')
    ? `float fbm(vec2 p) {
  float v = 0., a = .5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = rot(.5) * p * 2.03 + 17.; a *= .5; }
  return v;
}
`
    : ''
}
// The colour field at p: the distance from its centre, the way along its angle from it, or a smooth wash of 3
// octaves of noise from 0 to 4; with none, the distance from the plane's centre.
float field(vec2 p) {
  vec2 q = p - uFieldC.xy;
  if (uField.x < .5) return length(q);
  if (uField.x < 1.5) return dot(q, vec2(cos(uField.y), sin(uField.y)));
  q *= uField.z;
  return 4. * (.5 * noise(q) + .25 * noise(rot(.7) * q * 2.03 + 5.) + .125 * noise(rot(1.9) * q * 4.1 + 9.)) / .875;
}
// how far round the palette the field shifts every colour at p: depth times the field, in whole steps when it has them
float shiftAt(vec2 p) {
  float s = uField.w * field(p);
  return uFieldC.z > 0. ? floor(s * uFieldC.z + .5) / uFieldC.z : s;
}
// the field's shift at this sample, and a colour at palette index idx, shifted by it and blended into the far end's
// palette in a morph
float gShift = 0.;
vec3 colourAt(float idx) {
  vec3 c = palette(idx + uPalette.w + gShift);
  return ${has('morph') ? 'uToward.y > 0. ? mix(c, palette(idx + uToward.w + gShift), uToward.y) : c' : 'c'};
}

// a pigment at palette place at, blended into the far end's palette in a morph as the lines' colour is
vec3 pigment(float at) {
  vec3 c = palette(at + uPalette.w);
  return ${has('morph') ? 'uToward.y > 0. ? mix(c, palette(at + uToward.w), uToward.y) : c' : 'c'};
}

// The background under the lines, in screen space so the frame does not move it: a flat colour, a gradient along
// turn, or a soak (Frankenthaler's soak-stain): 3 translucent pools of pigment on raw canvas, each edge warped and
// darkened where the pigment gathered, their centres turned round by seep.
vec3 background(vec2 fc) {
  if (uBg.x < .5) return vec3(0);
  vec2 uv = (fc * 2. - uRes) / uRes.y;
  vec3 a = pigment(uBgSoak.x), c;
  if (uBg.x < 1.5) c = a;
  else if (uBg.x < 2.5) {
    float reach = length(uRes) / uRes.y;
    c = mix(a, pigment(uBgSoak.y), smoothstep(-reach, reach, dot(uv, vec2(cos(uBg.z), sin(uBg.z)))));
  }${
    has('soak')
      ? ` else {
    c = vec3(.86, .81, .71);
    float s = uBg.w, turn = 2. * PI * uBgSoak.w;
    for (int i = 0; i < 3; i++) {
      float f = float(i);
      vec2 at = s * (vec2(f - 1., .3 * sin(f * 2.4)) + .35 * vec2(cos(turn + f * 2.1), sin(turn + f * 2.1)));
      float n = fbm(uv / s * 1.6 + f * 7.3 + .4 * vec2(cos(turn), sin(turn)));
      float d = length(uv - at) / s - .55 + .35 * (n - .5), inside = 1. - smoothstep(-.008, .008, d);
      vec3 ink = pigment(mix(uBgSoak.x, uBgSoak.y, f * .5));
      // thinned paint soaked in about .7 of the way to its pigment, unevenly, and gathered dark at the edge
      c *= mix(vec3(1), ink, (.5 + .4 * n) * inside);
      c *= mix(vec3(1), .6 * ink, uBgSoak.z * inside * exp(-abs(d) * 30.));
    }
  }`
      : ''
  }
  return c * uBg.y;
}

// What one cell of a level draws: its distance, where it is round the cell's middle (turns) and how far out (rad), the
// way its rings and dots run (sgn, -1 for a cell turned the other way), how far its cell turn and ring phase go (f),
// the variant its hash picks and the seed it picked with, and the point in the cell after the Cell step's turn and
// how far its shapes dip into circles, for a metal fill's slope.
struct Cell { float d; float turn; float rad; float sgn; float f; int v; float seed; vec2 h; float dip; };

// how far out a cell is from the middle of the level, for the ring step: its middle's distance, in cells, on the
// lattices whose cells are translates; polar's and logpolar's ring; fold's mirror count (its id's own way, above)
float ringOf(vec2 q, vec4 cell, float kind) {
  if (kind == ${lattice('polar')} || kind == ${lattice('logpolar')}) return cell.w;
  if (kind == ${lattice('fold')}) return mod(cell.z, 2.) + cell.w;
  return length(q - cell.xy);
}

// the mirror step: a cell's offset reflected across each axis where its id is odd along it
vec2 mirrored(vec2 h, vec2 id) { return h * (1. - 2. * mod(id, 2.)); }

// the distance of variant row b of level row j at h, its shapes dipped into circles by dip
float variantDist(int j, int b, vec2 h, float dip) {
  vec4 s0 = row(j, b), s1 = row(j, b + 1), s2 = row(j, b + 2);
  float d = shapeOf(h, s1.w, s0.y, s0.z, s0.w, mix(s1.x, 1., dip), s1.y, s2.x, s2.y);
${
  has('join')
    ? `  // the joined shape, smooth-unioned in by its weight
  if (s2.w > 0.) {
    vec4 s3 = row(j, b + 3), s4 = row(j, b + 4), s5 = row(j, b + 5);
    float e = shapeOf(h - s5.xy, s3.x, s3.y, s3.z, s3.w, mix(s4.x, 1., dip), s4.y, s4.z, s4.w);
    d = mix(d, smin(d, e, s5.z), s2.w);
  }
`
    : ''
}  if (s2.z > 0.) d = abs(d) - s2.z;
  return d;
}

// cell id's shape at h (in the cell, turned by the Cell step) on level row j of weight w, ring out from the middle
Cell cellAt(int j, vec2 h, vec2 id, float w, float ring) {
  vec4 t4 = row(j, 4), t5 = row(j, 5), t6 = row(j, 6);
  Cell c;
  // a level whose far end has another id turns each cell over to the far end's seed at the cell's own time,
  // in the middle of the level's window, the cell's shapes dipping into circles as it does
  float over = .3 + .4 * hash(id + 7.7);
  c.seed = t6.z < over ? t6.x : t6.y;
  float dip = t6.x != t6.y ? 1. - smoothstep(0., .08, abs(t6.z - over)) : 0.;
  // the Cell step: parity turns odd cells the other way, hash turns each cell either way (Truchet), and both
  // flip the turned cells' ring phase and dots; ring turns and phases each cell by how far out it is; mirror's
  // reflection is in h already; a collapsed level does not turn
  float by = t4.x;
  c.sgn = (by == ${cell('hash')} ? hash(id + c.seed * 5.13 + 7.) : by == ${cell('parity')} ? mod(id.x + id.y, 2.) : 0.) > .5
    ? -1. : 1.;
  c.f = by == ${cell('ring')} ? ring : c.sgn;
  h = rot(c.f * t4.y * w) * h;
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
  c.d = variantDist(j, b, h, dip);
  vec2 q = rot(row(j, b + 1).y) * h;
  c.turn = atan(q.x, q.y) / (2. * PI);
  c.rad = length(q);
  c.h = h;
  c.dip = dip;
  return c;
}

// What a cell's line draws at depth, scale being how many screen units a cell unit spans: echo rings 1/rings apart,
// drifting by the ring phase. In a morph the far end's line is mixed in: the ring count morphs, and each end draws
// with its own echo, ring phase, line kind and crawl.
float drawn(Cell c, float ringPhase, float depth, float scale) {
  float ra = uContour.x + uContour.y * depth, rb = uTowardRings.x + uTowardRings.y * depth;
  float k = PI * mix(max(ra, 1.), max(rb, 1.), uToward.y);
  float lw = max(uLine.y + uLine.z * depth, 1e-5), lf = uFalloff.x + uFalloff.y * depth;
  vec4 dash = vec4(c.turn, c.rad * scale, max(uDots.x + uDots.y * depth, 1.), clamp(uDots.z + uDots.w * depth, 0., 1.));
  float a = contour(c.d, k, ra, uContour.z + c.f * ringPhase, uLine.x, scale, lw, lf, dash, c.sgn * uCrawl.x);
${
  has('morph')
    ? `  if (uToward.y > 0.)
    a = mix(a, contour(c.d, k, rb, uToward.z + c.f * ringPhase, uToward.x, scale, lw, lf, dash, c.sgn * uCrawl.y),
            uToward.y);
`
    : ''
}  // in screen units a cell the warps shrink to a few line widths across fades out rather than filling with line
  return a * mix(1., smoothstep(2. * lw, 8. * lw, scale), uLine.w);
}

${
  has('stretch')
    ? `// how far level row j's variations stretch the plane at q0 (to q): the linear weight's scale alone, else measured
// from the probes qx and qy, e off q0 along x and y, which the level's one vary gives with q
mat2 stretch(vec2 q, vec2 qx, vec2 qy, float e, int j) {
  if (row(j, 7).w > .5) return mat2(row(j, 2).x);
  return mat2((qx - q) / e, (qy - q) / e);
}

`
    : ''
}#ifdef FILL
// whether cell id a is in front of cell id b: the lower row, then the one further left
bool before(vec2 a, vec2 b) { return a.y < b.y || (a.y == b.y && a.x < b.x); }

// a fill's colour at index idx, its shadow side (lit 0) f1.w round the palette by f1.y (shade, by metal)
vec3 metalAt(float idx, float lit, vec4 f1) {
  vec3 c = colourAt(idx);
  return f1.y > 0. && lit < 1. ? mix(c, colourAt(idx + f1.w), f1.y * (1. - lit)) : c;
}

#ifdef METAL
// the slope of cell c's distance on level row j of weight w, in its cell before the Cell step's turn: taken for a
// cell a fill paints, never for every cell spill looks at
vec2 cellGrad(int j, Cell c, float w) {
  int b = 8 + ${VARIANT_TEXELS} * c.v;
  float e = 1e-3;
  vec2 g = (vec2(variantDist(j, b, c.h + vec2(e, 0), c.dip), variantDist(j, b, c.h + vec2(0, e), c.dip)) - c.d) / e;
  return transpose(rot(c.f * row(j, 4).y * w)) * g;
}
#endif

// The paint of cell c (id id, reflected where mirror) of level row j of weight w, from the ancestry index ci and the
// trap's distance as the level's line takes them: in bands in from its edge that flow as the echo rings do, each
// band's edge blended over a pixel (pxc, in cell units) into the next but at the shape's own edge, where no band lies
// beyond it, and on metal each facet lit or in shadow by its slope on the screen (through J) against the light; .a
// is how much of the pixel it covers, its edge softened inward by the ramp.
vec4 paint(int j, Cell c, vec2 id, float ci, float trap, float pxc, mat2 J, float w, bool mirror) {
  vec4 t5 = row(j, 5), f0 = row(j, ${FILL_TEXEL}), f1 = row(j, ${FILL_TEXEL} + 1), f2 = row(j, ${FILL_TEXEL} + 2);
  float cover = (1. - smoothstep(-max(pxc, f2.x), pxc, c.d)) * f0.x, lit = 1.;
  float idx = mix(ci, t5.x + t5.z * hash(id + c.seed * 3.7 + 11.), t5.y * w) + uTrap.x * trap + f0.z +
              f2.y * mod(id.x + id.y, 2.);
#ifdef METAL
  if (f1.y > 0.) {
    vec2 g = cellGrad(j, c, w);
    g = transpose(J) * (mirror ? mirrored(g, id) : g);
    lit = length(g) > 1e-9 ? smoothstep(-.03, .03, dot(normalize(g), vec2(cos(f1.z), sin(f1.z)))) : 1.;
  }
#endif
  if (f0.w <= 0.) return vec4(metalAt(idx, lit, f1), cover);
  float x0 = (uContour.z + c.f * row(j, 4).z) / PI, x = x0 - min(c.d, 0.) * f0.w, b = floor(x), e = x - b;
  float ww = pxc * f0.w, nb = e < .5 ? b - 1. : b + 1.;
  float t = e < .5 ? (b > floor(x0) ? 1. - smoothstep(-ww, ww, e) : 0.) : smoothstep(1. - ww, 1. + ww, e);
  return vec4(mix(metalAt(idx + b * f1.x, lit, f1), metalAt(idx + nb * f1.x, lit, f1), t), cover);
}
#endif

// one sample of the lines over the paint, which lies down the chain over the background bg, from the chain at row
// start: added to it, or over it where the first hit leaves it uncovered
vec3 render(vec2 fc, vec3 bg, int start) {
  vec2 p = rot(uFrame.w) * ((fc * 2. - uRes) / uRes.y) / uFrame.z + uFrame.xy;
  float r0 = length(p);
  // the ancestry index starts from the colour field, as far as the radius, and the field shifts every colour
  float ci = uPalette.z * field(p);
  gShift = shiftAt(p);
  vec3 add = vec3(0), first = vec3(0), ground = bg;
  float cover = 0., grown = 0.;
  // the orbit trap: how near the point has come to the trap's circle, from the frame's point on down the chain
  float trap = abs(r0 - uTrap.y);
  // how far the chain has stretched the screen at this pixel, for lines in screen units
  mat2 J = rot(uFrame.w) / uFrame.z;
  int j = start;
  for (int i = 0; i < MAX_DEPTH; i++) {
    if (j < 0) break;
    // a level is as deep as the weight above it, so a level collapsing or growing moves the depths below smoothly
    float depth = grown / uDepth;
    vec4 t0 = row(j, 0), t1 = row(j, 1), t4 = row(j, 4), t5 = row(j, 5), t6 = row(j, 6), t7 = row(j, 7);
    vec4 f0 = row(j, ${FILL_TEXEL});
    float w = t0.x, kc;
${has('stretch') ? metalFlag : ''}    // affine, variations, lattice; the level weight blends the re-tiling toward pass-through
${
  has('stretch')
    ? `    vec2 q0 = t0.y * (rot(t0.z) * p) + t1.xy, q, qx, qy;
    // the level's point, then, where the stretch is measured and a variation but linear has weight, the stretch's
    // two probes, from one vary call, so it is inlined once
    bool measured = uLine.w > 0. || metal;
    float e = 1e-3 * max(length(q0), 1e-3);
    for (int s = 0; s < (measured && t7.w <= .5 ? 3 : 1); s++) {
      vec2 v = vary(s == 0 ? q0 : s == 1 ? q0 + vec2(e, 0) : q0 + vec2(0, e), j);
      if (s == 0) q = v;
      else if (s == 1) qx = v;
      else qy = v;
    }
`
    : `    vec2 q0 = t0.y * (rot(t0.z) * p) + t1.xy, q = vary(q0, j);
`
}${
    has('spill')
      ? `    bool mirror = t4.x == ${cell('mirror')};
    mat2 Jq = t0.y * rot(t0.z) * J;
${has('stretch') ? '' : metalFlag}${stretchLine}    vec4 cell;
    vec2 local, nid;
    float px, scale;
    Cell own, near;
#ifdef FILL
    float pxc;
    bool fr = false, inFront, inBack;
    Cell front, back;
    vec2 fid, bid, fat;
#endif
    // the cell's own shape (k 4, o 0), then, where spill is on, the outlines of the shapes of the cells a step round
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
#ifdef FILL
        // in front order the neighbours are found from a point pulled a little toward the cell's middle, so a
        // sample on a row's edge cannot round into a row past the one beside it and lose the cell in front
        vec2 pull = fr ? 1e-3 * cell.xy : vec2(0), at = q - pull + dq;
#else
        vec2 at = q + dq;
#endif
        // the cell itself at q
        nc = lattice(k == 4 ? q : at, t1.zw, t7, kn);
        if (k != 4) {
#ifdef FILL
          nc.xy += pull - dq;
#else
          nc.xy -= dq;
#endif
        }
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
#ifdef FILL
        // front order: of the cells whose paint reaches the pixel (pxc, a pixel in cell units), the lowest row's then
        // the leftmost's in front, and the next behind it, painted first so the front's edge blends into it, not the
        // ground
        pxc = 2. / uRes.y / px;
        fr = f0.x > 0. && row(j, ${FILL_TEXEL} + 2).z > .5 && t6.w > 0.;
        front = own;
        back = own;
        fid = cell.zw;
        bid = cell.zw;
        fat = cell.xy;
        inFront = !fr || own.d < pxc;
        inBack = false;
#endif
        continue;
      }
      if (abs(c.d) < abs(near.d)) {
        near = c;
        nid = nc.zw;
      }
#ifdef FILL
      if (fr && c.d < pxc) {
        if (!inFront || before(nc.zw, fid)) {
          back = front;
          bid = fid;
          inBack = inFront;
          front = c;
          fid = nc.zw;
          fat = nc.xy;
          inFront = true;
        } else if (!inBack || before(nc.zw, bid)) {
          back = c;
          bid = nc.zw;
          inBack = true;
        }
      }
#endif
    }
    // draw: the cell's line, then, where spill is on, the nearest spilled outline's mixed in by spill, from one drawn
    // call, so it is inlined once
    float a;
    for (int s = 0; s < (t6.w > 0. ? 2 : 1); s++) {
      Cell c = own;
      if (s == 1) c = near;
      float l = drawn(c, t4.z, depth, scale);
      a = s == 0 ? l : mix(a, l, t6.w);
    }
`
      : `    vec4 cell = lattice(q, t1.zw, t7, kc);
    // the cell's offset, reflected where the Cell step mirrors
    bool mirror = t4.x == ${cell('mirror')};
    vec2 local = mirror ? mirrored(cell.xy, cell.zw) : cell.xy;
    mat2 Jq = t0.y * rot(t0.z) * J;
${has('stretch') ? '' : metalFlag}${stretchLine}    J = J * (1. - w) + kc * Jq * w;
    // how many screen units a cell unit spans here
    float px = inversesqrt(max(abs(determinant(J)), 1e-12)), scale = mix(1., px, uLine.w);
    // draw: the cell's shape and line
    Cell own = cellAt(j, mix(p, local, w), cell.zw, w, ringOf(q, cell, t7.x));
    float a = drawn(own, t4.z, depth, scale);
    // spill: the outlines of the shapes of the cells a step round it, drawn where they reach into this one (the
    // nearest outline, so overlapping shapes each show theirs), faded in by spill; the parse keeps it to lattices
    // whose cells are translates, triangle steps by half the pad to reach both halves, and voronoi's are its
    // pad's neighbours, each at its own jittered point
    Cell near = own;
    vec2 nid = cell.zw;
#ifdef FILL
    // front order: of the cells whose paint reaches the pixel (pxc, a pixel in cell units), the lowest row's then the
    // leftmost's in front, and the next behind it, painted first so the front's edge blends into it, not the ground
    float pxc = 2. / uRes.y / px;
    bool fr = f0.x > 0. && row(j, ${FILL_TEXEL} + 2).z > .5 && t6.w > 0.;
    Cell front = own, back = own;
    vec2 fid = cell.zw, bid = cell.zw, fat = cell.xy;
    bool inFront = !fr || own.d < pxc, inBack = false;
#endif
`
  }    // the line over a fill keeps as much of itself as the fill's line
    a *= f0.y;
    // a level whose cells are under a few pixels fades out rather than shimmer (log-polar's centre)
    a *= exp(-r0 * (uRadial.x + uRadial.y * depth)) * w * smoothstep(1., 3., uRes.y * .5 * px);
    // a colour field at cells is read at the middle of the first level's cell (its front cell's in front order), the
    // level's warps left out, so a shape takes one colour
    if (i == 0 && uFieldC.w > 0.) {
      mat2 unturn = transpose(rot(t0.z)) / t0.y;
      gShift = shiftAt(p - unturn * cell.xy);
#ifdef FILL
      // front order's cell fades in by spill, as its paint does
      if (fr && inFront) gShift = mix(gShift, shiftAt(p - unturn * fat), t6.w);
#endif
    }
    // colour: the ancestry index pulls toward the level's own colour as far as the level is grown, plus a per-cell
    // spread; a spilled outline wears its own cell's, by spill
    float ni = mix(ci, t5.x + t5.z * hash(nid + near.seed * 3.7 + 11.), t5.y * w);
#ifdef FILL
    float ci0 = ci;
#endif
    ci = mix(ci, t5.x + t5.z * hash(cell.zw + own.seed * 3.7 + 11.), t5.y * w);
    // the orbit trap takes in this level's point as far as the level is grown, and moves the index by its weight
    trap = mix(trap, min(trap, abs(length(mix(p, local, w)) - uTrap.y)), w);
    float li = mix(ci, ni, t6.w) + uTrap.x * trap;
    vec3 col = colourAt(li);
#ifdef FILL
    // the paint, each painted cell wearing its own colour, faded as the line is by the level's weight and its cells'
    // size, laid over the ground
    if (f0.x > 0.) {
      float shown = w * smoothstep(1., 3., uRes.y * .5 * px);
      vec3 under = ground;
      if (inBack) {
        vec4 c = paint(j, back, bid, ci0, trap, pxc, J, w, mirror);
        ground = mix(ground, c.rgb, clamp(c.a * shown, 0., 1.));
      }
      if (inFront) {
        vec4 c = paint(j, front, fid, ci0, trap, pxc, J, w, mirror);
        ground = mix(ground, c.rgb, clamp(c.a * shown, 0., 1.));
      }
      // front order fades in by spill over the cell's own paint, so a morph swaps it unseen where spill is nothing
      if (fr && t6.w < 1.) {
        vec4 c = paint(j, own, cell.zw, ci0, trap, pxc, J, w, mirror);
        ground = mix(mix(under, c.rgb, clamp(c.a * shown, 0., 1.)), ground, t6.w);
      }
    }
#endif
    add += col * a;
    float c = clamp(a, 0., 1.);
    first += (1. - cover) * col * c;
    cover += (1. - cover) * c;
    // the chain runs on in this cell, turned (and mirrored) by the Cell step
    p = rot(own.f * t4.y * w) * mix(p, local, w);
    grown += w;
    float below = row(j, 9 + ${VARIANT_TEXELS} * own.v).z;
    j = below >= 0. ? int(below) : int(t0.w);
  }
  return mix(ground + add, first + (1. - cover) * ground, uComposite);
}

void main() {
  vec3 c = vec3(0), bg = background(gl_FragCoord.xy);
  for (int y = 0; y < 3; y++) for (int x = 0; x < 3; x++)
    if (x < uAA && y < uAA)
      // a lone level's swap crossfades: its other switches' picture mixed in by how far in it is
      for (int k = 0; k < ${has('morph') ? 2 : 1}; k++) {
        float w = k == 0 ? 1. - uCross.y : uCross.y;
        if (w > 0.) c += w * render(gl_FragCoord.xy + (vec2(x, y) + .5) / float(uAA) - .5, bg, k * int(uCross.x));
      }
  c /= float(uAA * uAA);
  outColor = vec4(pow(c, vec3(1. / uGamma)), 1.);
}
`
}
