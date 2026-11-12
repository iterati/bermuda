// The fragment shader, generated from a set of parts: the core is in every program, and each part (a variation,
// shape or lattice kind, or a feature such as spill, the morph or the fills) only in the programs given it, while
// uniforms pick what runs, so changing a scene's values never needs another program. The parts are the engines'
// (engines/), each of which fills its places in the core's text for the parts a program holds. needs gives the parts
// a scene, or a morph between two, draws with, by what it holds and never by its values. The levels live in a float
// texture, one row per level, laid out alike for every program (render.ts packs it).
import {
  MAX_DEPTH,
  MAX_STOPS,
  MAX_VARIANTS,
  type LatticeKind,
  type Scene,
  type ShapeKind,
  type VariationKind,
} from './scene'
import { ENGINES, FILL_TEXEL, LAYOUT } from './engines'
import { frontAlone, metalFlag } from './engines/deco'
import { cell, lattice, VARIANT_TEXELS, type Place } from './engines/engine'
import { stretchLine } from './engines/fractal'

// A level's row, in texels, the core's:
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
// then each engine's own, in registry order (Fractal's from VARY_TEXEL, Deco's from FILL_TEXEL).

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
export const PARTS: readonly Part[] = ENGINES.flatMap((e) => e.parts)

// The parts a scene draws with, sub-chains included, or a morph between two: both ends' and the morph's, as a
// morph's scene grows what one end lacks from what draws as none. Each is there by what the scene holds, never by a
// value, so no modulator, macro, preset or dice needs another program: each engine adds its own.
export function needs(a: Scene, b?: Scene): Set<Part> {
  if (b) return new Set([...needs(a), ...needs(b), 'morph'])
  const parts = new Set<Part>()
  const add = (part: string) => {
    if ((PARTS as readonly string[]).includes(part)) parts.add(part as Part)
  }
  for (const engine of ENGINES) engine.needs?.(a, add)
  return parts
}

// The shader of the core and the parts given, every part's by default: each place in the core's text filled by the
// engines, else the core's own there. Fills and metal keep the preprocessor's FILL and METAL (METAL brings FILL); a
// kind or feature left out leaves the rest of the core's text as it is.
export function generateShader(parts: Iterable<Part> = PARTS): string {
  const on = new Set(parts)
  const has = (part: string) => on.has(part as Part)
  const texts = ENGINES.map((engine) => engine.glsl(has, LAYOUT))
  const at = (place: Place, none = '') => {
    const filled = texts.flatMap((text) => text[place] ?? [])
    return filled.length ? filled.join('') : none
  }
  return `#version 300 es
${at('defines')}#ifdef METAL
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
${at('shapeFunctions')}

// a shape of kind (SHAPES' index) at p, size r, form f, count n and the star's m
float sdKind(float kind, vec2 p, float r, float f, float n, float m) {
  switch (int(kind)) {
${at('shapeCases')}
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

${at('afterShape')}// the nearest point of the lattice a(1, 0) + b e2, centre-nested, from the 4 corners of p's parallelogram:
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
${at('afterOblique')}
${at('beforeVary')}// level row j's weighted sum of variations at p, held inside 1e5 either way
vec2 vary(vec2 p, int j) {
  if (row(j, 7).w > .5) return row(j, 2).x * p;
  float r2 = dot(p, p), r = sqrt(r2), th = atan(p.x, p.y);
  float ph = r > 1e-9 ? atan(p.y, p.x) : 0.;
  vec2 sc = p / max(r, 1e-9), pc = clamp(p, -4., 4.), q = vec2(0);
  vec4 g;
${at('vary')}
  return clamp(q, vec2(-1e5), vec2(1e5));
}

// A level's lattice: the local offset .xy and the cell id .zw, and k, the cells per unit at p.
// Ids are whole numbers, so parity is (id.x + id.y) mod 2.
vec4 lattice(vec2 p, vec2 e2, vec4 t7, out float k) {
  float kind = t7.x, n = t7.y;
  k = 1.;
${at('lattice')}
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
${at('palette')}  lab.x = clamp(.5 + (lab.x - .5) * uPalette.y, 0., 1.);
  return oklabToSrgb(lab);
}

${at('beforeLine')}// a line of kind at distance d from it; dots also take dash (dotted's, with the dot count in z), fading from the whole
// count below to the one above, and their crawl phase
float lineOf(float kind, float d, float w, float f, vec4 dash, float phase) {
  if (kind < .5) return min(pow(w / max(d, 1e-6), f), 8.);
  if (kind < 1.5) return pow(1. - smoothstep(0., w, d), f);
  if (kind < 2.5) return 1. - step(w, d);
${at('lineTail', '  return 1. - smoothstep(w, w * (1. + f), d);')}
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
${at('afterNoise')}
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
  return ${at('colourAt', 'c')};
}

// a pigment at palette place at, blended into the far end's palette in a morph as the lines' colour is
vec3 pigment(float at) {
  vec3 c = palette(at + uPalette.w);
  return ${at('pigment', 'c')};
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
  }${at('background')}
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
${at('variantDist')}  if (s2.z > 0.) d = abs(d) - s2.z;
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
${at('drawn')}  // in screen units a cell the warps shrink to a few line widths across fades out rather than filling with line
  return a * mix(1., smoothstep(2. * lw, 8. * lw, scale), uLine.w);
}

${at('afterDrawn')}${at('beforeRender')}
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
${at('flag')}    // affine, variations, lattice; the level weight blends the re-tiling toward pass-through
${at('point', '    vec2 q0 = t0.y * (rot(t0.z) * p) + t1.xy, q = vary(q0, j);\n')}${at(
    'cells',
    `    vec4 cell = lattice(q, t1.zw, t7, kc);
    // the cell's offset, reflected where the Cell step mirrors
    bool mirror = t4.x == ${cell('mirror')};
    vec2 local = mirror ? mirrored(cell.xy, cell.zw) : cell.xy;
    mat2 Jq = t0.y * rot(t0.z) * J;
${has('stretch') ? '' : metalFlag(LAYOUT)}${stretchLine(has)}    J = J * (1. - w) + kc * Jq * w;
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
${frontAlone(LAYOUT)}`,
  )}    // the line over a fill keeps as much of itself as the fill's line
    a *= f0.y;
    // a level whose cells are under a few pixels fades out rather than shimmer (log-polar's centre)
    a *= exp(-r0 * (uRadial.x + uRadial.y * depth)) * w * smoothstep(1., 3., uRes.y * .5 * px);
    // a colour field at cells is read at the middle of the first level's cell (its front cell's in front order), the
    // level's warps left out, so a shape takes one colour
    if (i == 0 && uFieldC.w > 0.) {
      mat2 unturn = transpose(rot(t0.z)) / t0.y;
      gShift = shiftAt(p - unturn * cell.xy);
${at('fieldAtCells')}    }
    // colour: the ancestry index pulls toward the level's own colour as far as the level is grown, plus a per-cell
    // spread; a spilled outline wears its own cell's, by spill
    float ni = mix(ci, t5.x + t5.z * hash(nid + near.seed * 3.7 + 11.), t5.y * w);
${at('ancestry')}    ci = mix(ci, t5.x + t5.z * hash(cell.zw + own.seed * 3.7 + 11.), t5.y * w);
    // the orbit trap takes in this level's point as far as the level is grown, and moves the index by its weight
    trap = mix(trap, min(trap, abs(length(mix(p, local, w)) - uTrap.y)), w);
    float li = mix(ci, ni, t6.w) + uTrap.x * trap;
    vec3 col = colourAt(li);
${at('paint')}    add += col * a;
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
      for (int k = 0; k < ${at('crossChain', '1')}; k++) {
        float w = k == 0 ? 1. - uCross.y : uCross.y;
        if (w > 0.) c += w * render(gl_FragCoord.xy + (vec2(x, y) + .5) / float(uAA) - .5, bg, k * int(uCross.x));
      }
  c /= float(uAA * uAA);
  outColor = vec4(pow(c, vec3(1. / uGamma)), 1.);
}
`
}
