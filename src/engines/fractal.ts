// Fractal: flam3's variations, which bend each level's plane before its lattice, and the stretch, how far they
// stretch the screen at a pixel, measured where lines are in screen units or metal reads its slope. linear is the
// core's, in every program. The weights of VARIATIONS' first eight are in the core's row texels 2 and 3; its own
// texels, from its first (VARY_TEXEL), hold the weights of the rest, four a texel, in order.
import { allLevels, VARIATIONS, variationWeight, type VariationKind } from '../scene'
import { metalFlag } from './deco'
import { kept, kinds, type Engine, type Has } from './engine'

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
// the texel and component a variation's weight sits in, the ninth on from the engine's first texel, vary
const weightAt = (i: number, vary: number) => (i < 8 ? [2 + (i >> 2), i & 3] : [vary + ((i - 8) >> 2), (i - 8) & 3])

// the stretch measured ahead of the level's cells, where the program holds it
export const stretchLine = (has: Has) =>
  has('stretch') ? '    if (measured) Jq = stretch(q, qx, qy, e, j) * Jq;\n' : ''

export const fractal: Engine = {
  name: 'fractal',
  parts: [...kinds('variation', VARIATIONS), 'stretch'],
  needs: (scene, add) => {
    for (const { level } of allLevels(scene.levels)) level.variations.forEach(({ kind }) => add(`variation.${kind}`))
    if (scene.line.units === 'screen') add('stretch')
  },
  glsl: (has, layout) => {
    // each texel's four weights, skipped whole where all are 0, and left out where none of its kinds is kept
    const variations = new Set(kept(has, 'variation', VARIATIONS))
    const texels = [...new Set(VARIATIONS.map((_, i) => weightAt(i, layout.fractal)[0]))]
    const vary = texels
      .flatMap((texel) => {
        const lines = VARIATIONS.flatMap((kind, i) => {
          const [at, c] = weightAt(i, layout.fractal)
          const w = `g.${'xyzw'[c]}`
          return at === texel && variations.has(kind)
            ? [`    if (${w} != 0.) { float w = ${w}; q += w * (${VARIATION_GLSL[kind]}); } // ${kind}`]
            : []
        })
        return lines.length ? [`  g = row(j, ${texel});\n  if (g != vec4(0)) {\n${lines.join('\n')}\n  }`] : []
      })
      .join('\n')
    const varyFunctions = [...variations].flatMap((kind) => VARIATION_FUNCTIONS[kind] ?? [])
    return {
      beforeVary: varyFunctions.length
        ? `// flam3's ex, edisc, elliptic and foci, which take more than one line
${varyFunctions.join('\n')}

`
        : '',
      vary,
      ...(has('stretch')
        ? {
            afterDrawn: `// how far level row j's variations stretch the plane at q0 (to q): the linear weight's scale alone, else measured
// from the probes qx and qy, e off q0 along x and y, which the level's one vary gives with q
mat2 stretch(vec2 q, vec2 qx, vec2 qy, float e, int j) {
  if (row(j, 7).w > .5) return mat2(row(j, 2).x);
  return mat2((qx - q) / e, (qy - q) / e);
}

`,
            flag: metalFlag(layout),
            point: `    vec2 q0 = t0.y * (rot(t0.z) * p) + t1.xy, q, qx, qy;
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
`,
          }
        : {}),
    }
  },
  texels: Math.ceil((VARIATIONS.length - 8) / 4),
  pack: (level, put) => put(0, ...VARIATIONS.slice(8).map((kind) => variationWeight(level, kind))),
}
