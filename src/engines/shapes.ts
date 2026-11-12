// Shapes: iq's 2D distance functions, each variant's shape, and the join, a second shape smooth-unioned into it. star
// is the core's, in every program. Its texels are the core's, each variant's.
import { allLevels, SHAPES, type Shape, type ShapeKind } from '../scene'
import { kept, kinds, type Engine, type KnobMorph } from './engine'

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

export const shapes: Engine = {
  name: 'shapes',
  parts: [...kinds('shape', SHAPES), 'join'],
  needs: (scene, add) => {
    for (const { level } of allLevels(scene.levels))
      for (const { shape } of level.variants) {
        add(`shape.${shape.kind ?? 'star'}`)
        if (!shape.join) continue
        add('join')
        add(`shape.${shape.join.shape.kind ?? 'star'}`)
      }
  },
  glsl: (has) => {
    const shapeKinds = kept(has, 'shape', SHAPES)
    const cases = shapeKinds
      .map((kind) => `    case ${SHAPES.indexOf(kind)}: return ${SHAPE_GLSL[kind]}; // ${kind}`)
      .join('\n')
    const shapeFunctions = SHAPES.filter(
      (kind) => shapeKinds.includes(kind) || (kind === 'box' && has('shape.ziggurat')),
    )
      .flatMap((kind) => SHAPE_FUNCTIONS[kind] ?? [])
      .join('\n')
    return {
      shapeFunctions,
      shapeCases: cases,
      ...(has('join')
        ? {
            afterShape: `// iq's quadratic smooth minimum, k wide
float smin(float a, float b, float k) {
  k = max(k, 1e-6) * 4.;
  float h = max(k - abs(a - b), 0.) / k;
  return min(a, b) - h * h * k * .25;
}

`,
            variantDist: `  // the joined shape, smooth-unioned in by its weight
  if (s2.w > 0.) {
    vec4 s3 = row(j, b + 3), s4 = row(j, b + 4), s5 = row(j, b + 5);
    float e = shapeOf(h - s5.xy, s3.x, s3.y, s3.z, s3.w, mix(s4.x, 1., dip), s4.y, s4.z, s4.w);
    d = mix(d, smin(d, e, s5.z), s2.w);
  }
`,
          }
        : {}),
    }
  },
}

// a join one side lacks is there at weight 0; shape morphs the two shapes
export function mixJoin(a: Shape, b: Shape, k: KnobMorph, shape: (a: Shape, b: Shape) => Shape): Shape['join'] {
  if (!a.join && !b.join) return undefined
  const ja = a.join ?? { ...b.join!, weight: { value: 0 } }
  const jb = b.join ?? { ...a.join!, weight: { value: 0 } }
  return {
    shape: shape(ja.shape, jb.shape),
    offset: [k(ja.offset[0], jb.offset[0]), k(ja.offset[1], jb.offset[1])],
    blend: k(ja.blend, jb.blend),
    weight: k(ja.weight, jb.weight),
  }
}
