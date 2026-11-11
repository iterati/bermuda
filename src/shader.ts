// The one fragment shader, generated once: every module is in it and uniforms pick which runs,
// so changing a scene never recompiles. The levels live in a float texture, one row per level (render.ts packs it).
import { MAX_DEPTH, MAX_STOPS, MAX_VARIANTS, VARIATIONS, type VariationKind } from './scene'

// A level's row, in texels:
//   0 weight, scale, turn, next row (-1 ends the chain)
//   1 offset x, offset y, e2 x, e2 y
//   2 and 3: the weights of VARIATIONS, in order
//   4 cell by (0 none, 1 parity), cell turn, cell phase (radians), variant count
//   5 colour at, colour speed, cell spread, total share
//   6 + 2v: variant v's share, n, m, r
//   7 + 2v: variant v's round, twist, the row its sub-chain starts at (-1: none), unused
export const ROW_TEXELS = 6 + 2 * MAX_VARIANTS

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

export function generateShader(): string {
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
uniform float uDepth;             // the longest chain, for depth spreads
uniform vec4 uContour;            // rings, their spread, the running ring phase
uniform vec2 uRadial;             // radial weight, its spread
uniform vec4 uLine;               // kind (glow, smooth, hard, band), width, its spread, units (0 cell, 1 screen)
uniform vec2 uFalloff;            // falloff, its spread
uniform int uStopCount;
uniform vec4 uStops[MAX_STOPS];   // at, L, C, h
uniform int uStopMix[MAX_STOPS];  // 0 straight, 1 short, 2 long
uniform vec4 uPalette;            // hue, contrast, radius, running index
uniform int uComposite;           // 0 add, 1 first hit
uniform int uAA;
uniform float uGamma;
out vec4 outColor;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec4 row(int j, int k) { return texelFetch(uLevels, ivec2(k, j), 0); }
float hash(vec2 id) { return fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453); }

// iq's sdStar: n points, m from 1 (a dual star) through 2 (an n-gon) to n (spokes)
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

// the nearest point of the lattice a(1, 0) + b e2, centre-nested, from the 4 corners of p's parallelogram:
// the local offset and the id (a, b)
vec4 lattice(vec2 p, vec2 e2) {
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

vec2 vary(vec2 p, vec4 wa, vec4 wb) {
  float r2 = dot(p, p), r = sqrt(r2), th = atan(p.x, p.y);
  vec2 q = vec2(0);
${vary}
  return q;
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

// the palette round its OKLCh stops: each segment straight through OKLab, or the short or long way round the hue
vec3 palette(float t) {
  t = fract(t);
  int k = uStopCount - 1;
  for (int i = 0; i < MAX_STOPS; i++) if (i < uStopCount && uStops[i].x <= t) k = i;
  int k2 = k + 1 >= uStopCount ? 0 : k + 1;
  vec4 a = uStops[k], b = uStops[k2];
  float a1 = k2 <= k ? b.x + 1. : b.x;
  float f = clamp(((t < a.x ? t + 1. : t) - a.x) / max(a1 - a.x, 1e-5), 0., 1.);
  float ha = a.w + uPalette.x, hb = b.w + uPalette.x;
  vec3 lab;
  if (uStopMix[k] == 0) {
    lab = mix(vec3(a.y, a.z * cos(ha), a.z * sin(ha)), vec3(b.y, b.z * cos(hb), b.z * sin(hb)), f);
  } else {
    float dh = mod(hb - ha + PI, 2. * PI) - PI;
    if (uStopMix[k] == 2) dh -= sign(dh + 1e-6) * 2. * PI;
    float h = ha + dh * f, c = mix(a.z, b.z, f);
    lab = vec3(mix(a.y, b.y, f), c * cos(h), c * sin(h));
  }
  lab.x = clamp(.5 + (lab.x - .5) * uPalette.y, 0., 1.);
  return oklabToSrgb(lab);
}

float lineOf(float d, float w, float f) {
  if (uLine.x < .5) return min(pow(w / max(d, 1e-6), f), 8.);
  if (uLine.x < 1.5) return pow(1. - smoothstep(0., w, d), f);
  if (uLine.x < 2.5) return 1. - step(w, d);
  return 1. - smoothstep(w, w * (1. + f), d);
}

vec3 render(vec2 fc) {
  vec2 p = rot(uFrame.w) * ((fc * 2. - uRes) / uRes.y) / uFrame.z + uFrame.xy;
  float r0 = length(p);
  float ci = uPalette.z * r0;
  vec3 acc = vec3(0);
  float cover = 0., S = 1.;
  int j = 0;
  for (int i = 0; i < MAX_DEPTH; i++) {
    if (j < 0) break;
    float depth = float(i) / uDepth;
    vec4 t0 = row(j, 0), t1 = row(j, 1), t4 = row(j, 4), t5 = row(j, 5);
    float w = t0.x;
    // affine, variations, lattice; the level weight blends the re-tiling toward pass-through
    vec4 cell = lattice(vary(t0.y * (rot(t0.z) * p) + t1.xy, row(j, 2), row(j, 3)), t1.zw);
    vec2 h = mix(p, cell.xy, w);
    S *= mix(1., t0.y, w);
    // the Cell step: parity turns odd cells the other way and flips their ring phase
    float sgn = t4.x > .5 && mod(cell.z + cell.w, 2.) > .5 ? -1. : 1.;
    h = rot(sgn * t4.y) * h;
    // the per-cell pick among the variants, by share
    float pick = hash(cell.zw + float(j) * 17.31) * t5.w, shares = 0.;
    int v = 0;
    for (int k = 0; k < MAX_VARIANTS; k++) {
      if (float(k) >= t4.w) break;
      v = k;
      shares += row(j, 6 + 2 * k).x;
      if (pick < shares) break;
    }
    vec4 sa = row(j, 6 + 2 * v), sb = row(j, 7 + 2 * v);
    // draw: star, contour, line
    float d = mix(sdStar(rot(sb.y) * h, sa.w, sa.y, sa.z), length(h) - sa.w, sb.x);
    // echo rings 1/rings apart, drifting by the ring phase
    float rings = uContour.x + uContour.y * depth, k = PI * max(rings, 1.);
    d = mix(abs(d), abs(sin(d * k + uContour.z + sgn * t4.z)) / k, clamp(rings, 0., 1.));
    if (uLine.w > .5) d *= uFrame.z / S;
    float a = lineOf(d, max(uLine.y + uLine.z * depth, 1e-5), uFalloff.x + uFalloff.y * depth)
      * exp(-r0 * (uRadial.x + uRadial.y * depth)) * w;
    // colour: the ancestry index pulls toward the level's own colour, plus a per-cell spread
    ci = mix(ci, t5.x + t5.z * hash(cell.zw + float(j) * 3.7 + 11.), t5.y);
    vec3 col = palette(ci + uPalette.w);
    if (uComposite == 0) acc += col * a;
    else { float c = clamp(a, 0., 1.); acc += (1. - cover) * col * c; cover += (1. - cover) * c; }
    p = h;
    j = sb.z >= 0. ? int(sb.z) : int(t0.w);
  }
  return acc;
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
