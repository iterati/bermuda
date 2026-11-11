// The one fragment shader, generated once: every module is in it and uniforms pick which runs,
// so changing a scene never recompiles. The levels live in a float texture, one row per level (render.ts packs it).
import { MAX_DEPTH, MAX_STOPS, MAX_VARIANTS, VARIATIONS, type VariationKind } from './scene'

// A level's row, in texels:
//   0 weight, scale, turn, next row (-1 ends the chain)
//   1 offset x, offset y, e2 x, e2 y
//   2 and 3: the weights of VARIATIONS, in order
//   4 cell by (0 none, 1 parity), cell turn, cell phase (radians), variant count
//   5 colour at, colour speed, cell spread, total share
//   6 the level's hash seed (from its id), its far end's in a morph, how far through its window it is, unused
//   7 + 2v: variant v's share, n, m, r
//   8 + 2v: variant v's round, twist, the row its sub-chain starts at (-1: none), unused
export const ROW_TEXELS = 7 + 2 * MAX_VARIANTS

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
uniform float uDepth;             // the heaviest chain's weight, for depth spreads
uniform vec4 uContour;            // rings, their spread, the running ring phase
uniform vec2 uRadial;             // radial weight, its spread
uniform vec4 uLine;               // kind (glow, smooth, hard, band), width, its spread, units (0 cell to 1 screen)
uniform vec2 uFalloff;            // falloff, its spread
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

float lineOf(float kind, float d, float w, float f) {
  if (kind < .5) return min(pow(w / max(d, 1e-6), f), 8.);
  if (kind < 1.5) return pow(1. - smoothstep(0., w, d), f);
  if (kind < 2.5) return 1. - step(w, d);
  return 1. - smoothstep(w, w * (1. + f), d);
}

// a contour's line as kind: the outline, faded by rings from 0 to 1 into echo rings pi/k apart drifting by phase;
// scale takes the distance to the line's units
float contour(float d, float k, float rings, float phase, float kind, float scale, float w, float f) {
  float echo = clamp(rings, 0., 1.);
  float a = echo > 0. ? lineOf(kind, abs(sin(d * k + phase)) / k * scale, w, f) : 0.;
  return echo < 1. ? mix(lineOf(kind, abs(d) * scale, w, f), a, echo) : a;
}

vec3 render(vec2 fc) {
  vec2 p = rot(uFrame.w) * ((fc * 2. - uRes) / uRes.y) / uFrame.z + uFrame.xy;
  float r0 = length(p);
  float ci = uPalette.z * r0;
  vec3 add = vec3(0), first = vec3(0);
  float cover = 0., S = 1., grown = 0.;
  int j = 0;
  for (int i = 0; i < MAX_DEPTH; i++) {
    if (j < 0) break;
    // a level is as deep as the weight above it, so a level collapsing or growing moves the depths below smoothly
    float depth = grown / uDepth;
    vec4 t0 = row(j, 0), t1 = row(j, 1), t4 = row(j, 4), t5 = row(j, 5);
    vec4 t6 = row(j, 6);
    float w = t0.x;
    // affine, variations, lattice; the level weight blends the re-tiling toward pass-through
    vec4 cell = lattice(vary(t0.y * (rot(t0.z) * p) + t1.xy, row(j, 2), row(j, 3)), t1.zw);
    vec2 h = mix(p, cell.xy, w);
    S *= mix(1., t0.y, w);
    // the Cell step: parity turns odd cells the other way and flips their ring phase; a collapsed level does not turn
    float sgn = t4.x > .5 && mod(cell.z + cell.w, 2.) > .5 ? -1. : 1.;
    h = rot(sgn * t4.y * w) * h;
    // a level whose far end has another id turns each cell over to the far end's seed at the cell's own time,
    // in the middle of the level's window, the cell's shape dipping into a circle as it does
    float over = .3 + .4 * hash(cell.zw + 7.7), seed = t6.z < over ? t6.x : t6.y;
    float dip = t6.x != t6.y ? 1. - smoothstep(0., .08, abs(t6.z - over)) : 0.;
    // the per-cell pick among the variants, by share
    float pick = hash(cell.zw + seed * 17.31) * t5.w, shares = 0.;
    int v = 0;
    for (int k = 0; k < MAX_VARIANTS; k++) {
      if (float(k) >= t4.w) break;
      v = k;
      shares += row(j, 7 + 2 * k).x;
      if (pick < shares) break;
    }
    vec4 sa = row(j, 7 + 2 * v), sb = row(j, 8 + 2 * v);
    // draw: star, contour, line
    float d = mix(sdStar(rot(sb.y) * h, sa.w, sa.y, sa.z), length(h) - sa.w, mix(sb.x, 1., dip));
    // echo rings 1/rings apart, drifting by the ring phase; in a morph the ring count morphs, and each end draws
    // with its own echo, ring phase and line kind, their lines mixed
    float ra = uContour.x + uContour.y * depth, rb = uTowardRings.x + uTowardRings.y * depth;
    float k = PI * mix(max(ra, 1.), max(rb, 1.), uToward.y);
    float scale = mix(1., uFrame.z / S, uLine.w);
    float lw = max(uLine.y + uLine.z * depth, 1e-5), lf = uFalloff.x + uFalloff.y * depth;
    float a = contour(d, k, ra, uContour.z + sgn * t4.z, uLine.x, scale, lw, lf);
    if (uToward.y > 0.)
      a = mix(a, contour(d, k, rb, uToward.z + sgn * t4.z, uToward.x, scale, lw, lf), uToward.y);
    a *= exp(-r0 * (uRadial.x + uRadial.y * depth)) * w;
    // colour: the ancestry index pulls toward the level's own colour as far as the level is grown, plus a per-cell spread
    ci = mix(ci, t5.x + t5.z * hash(cell.zw + seed * 3.7 + 11.), t5.y * w);
    vec3 col = palette(ci + uPalette.w);
    if (uToward.y > 0.) col = mix(col, palette(ci + uToward.w), uToward.y);
    add += col * a;
    float c = clamp(a, 0., 1.);
    first += (1. - cover) * col * c;
    cover += (1. - cover) * c;
    p = h;
    grown += w;
    j = sb.z >= 0. ? int(sb.z) : int(t0.w);
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
