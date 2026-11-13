// Deco: step A's fills and their metal, and step B's halftone. A level's fill paints its cells' shapes in bands in from
// their edges, the line over it keeping as much of itself as the fill's line, and metal lights each facet by its slope
// on the screen. A level's halftone draws it again at its nearest dot's centre, on its own lattice or on the picture's
// one screen, and sizes the dot by what it drew there. Its preprocessor text is in every program, FILL and METAL
// defined only where the program holds fill or metal, HT and HTS where it holds the halftone or its screen; the front
// order's and a lattice dot's text run inside Tiling's spill loop and the core's own cell, and metal's flag ahead of
// the stretch.
// Its row texels, from its first (FILL_TEXEL):
//   0: the fill's amount, line, tone, bands (a level without a fill: 0, 1, 0, 0)
//   1: its step, metal, light (radians), shade
//   2: its ramp, alternate, front order (0 or 1), unused
//   3: the halftone's amount, grid (GRIDS' index), pitch, size (a level without a halftone: amount 0)
//   4: its fade, turn (radians), reach, unused
import { allLevels, GRIDS, screened, type Fill, type Halftone } from '../scene'
import { lattice, RAD, VARIANT_TEXELS, type Engine, type KnobMorph, type Layout } from './engine'

// metal's flag, ahead of the level's vary where the stretch is, as it picks how many points vary takes
export const metalFlag = (layout: Layout) => `#ifdef METAL
    // metal reads its slope on the screen, so it measures the stretch as lines in screen units do
    bool metal = f0.x > 0. && row(j, ${layout.deco} + 1).y > 0.;
#else
    bool metal = false;
#endif
`

// the front order's cells, declared ahead of spill's loop
export const frontDeclared = `#ifdef FILL
    float pxc;
    bool fr = false, inFront, inBack;
    Cell front, back;
    vec2 fid, bid, fat;
#endif
`
// a neighbour's point, pulled in front order, and its offset back from it
export const pulled = `#ifdef FILL
        // in front order the neighbours are found from a point pulled a little toward the cell's middle, so a
        // sample on a row's edge cannot round into a row past the one beside it and lose the cell in front
        vec2 pull = fr ? 1e-3 * cell.xy : vec2(0), at = q - pull + dq;
#else
        vec2 at = q + dq;
#endif
`
export const unpulled = `#ifdef FILL
          nc.xy += pull - dq;
#else
          nc.xy -= dq;
#endif
`
// the front order set up from the own cell, in spill's loop
export const frontOwn = (layout: Layout) => `#ifdef FILL
        // front order: of the cells whose paint reaches the pixel (pxc, a pixel in cell units), the lowest row's then
        // the leftmost's in front, and the next behind it, painted first so the front's edge blends into it, not the
        // ground
        pxc = 2. / uRes.y / px;
        fr = f0.x > 0. && row(j, ${layout.deco} + 2).z > .5 && t6.w > 0.;
        front = own;
        back = own;
        fid = cell.zw;
        bid = cell.zw;
        fat = cell.xy;
        inFront = !fr || own.d < pxc;
        inBack = false;
#endif
`
// a neighbour in front of the front cell, or behind it, in spill's loop
export const frontNear = `#ifdef FILL
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
`
// the front order set up from the own cell, where there is no spill loop
export const frontAlone = (layout: Layout) => `#ifdef FILL
    // front order: of the cells whose paint reaches the pixel (pxc, a pixel in cell units), the lowest row's then the
    // leftmost's in front, and the next behind it, painted first so the front's edge blends into it, not the ground
    float pxc = 2. / uRes.y / px;
    bool fr = f0.x > 0. && row(j, ${layout.deco} + 2).z > .5 && t6.w > 0.;
    Cell front = own, back = own;
    vec2 fid = cell.zw, bid = cell.zw, fat = cell.xy;
    bool inFront = !fr || own.d < pxc, inBack = false;
#endif
`

// a lattice dot: the cell's point moved to its own lattice's nearest dot, pitch to a cell in its cell frame (the pad
// divided on oblique and voronoi, a square pad elsewhere), q with it so the cells round it are found round the dot
export const latticeDot = (cell: string, indent: string) => `#ifdef HT
${indent}if (pitch > 0.) {
${indent}  vec2 e2 = t7.x == ${lattice('oblique')} || t7.x == ${lattice('voronoi')} ? t1.zw : vec2(0, 1);
${indent}  vec2 o = oblique(${cell}.xy * pitch, e2).xy / pitch;
${indent}  q -= o;
${indent}  ${cell}.xy -= o;
${indent}  off = length(o);
${indent}}
#endif
`

export const deco: Engine = {
  name: 'deco',
  parts: ['fill', 'metal', 'halftone', 'screen'],
  // a fill brings metal even at metal 0, and metal the stretch, as metal reads its slope on the screen; a halftone on
  // a screen brings the screen, at amount 0 too
  needs: (scene, add) => {
    for (const { level } of allLevels(scene.levels)) {
      if (level.fill) {
        add('fill')
        add('metal')
        add('stretch')
      }
      if (level.halftone) add('halftone')
      if (screened(level)) add('screen')
    }
  },
  glsl: (has, layout) => {
    // the screen brings the halftone
    const ht = has('halftone') || has('screen')
    return {
      defines: `${has('metal') ? '#define METAL\n' : has('fill') ? '#define FILL\n' : ''}${
        has('screen') ? '#define HTS\n#define HT\n' : has('halftone') ? '#define HT\n' : ''
      }`,
      beforeRender: `#ifdef FILL
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
  vec4 t5 = row(j, 5), f0 = row(j, ${layout.deco}), f1 = row(j, ${layout.deco} + 1), f2 = row(j, ${layout.deco} + 2);
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
${
  ht
    ? `#ifdef HTS
uniform vec4 uScreen;  // the picture's one screen: on, dots up the screen, turn (radians), hex
#endif
`
    : ''
}`,
      fieldAtCells: `#ifdef FILL
      // front order's cell fades in by spill, as its paint does
      if (fr && inFront) gShift = mix(gShift, shiftAt(p - unturn * fat), t6.w);
#endif
`,
      ancestry: `#ifdef FILL
    float ci0 = ci;
#endif
`,
      paint: `#ifdef FILL
    // the paint, each painted cell wearing its own colour, faded as the line is by the level's weight and its cells'
    // size, laid over the ground; laid is how much of the pixel it covers, as the ground's own is mixed
    if (f0.x > 0.) {
      float shown = w * smoothstep(1., 3., uRes.y * .5 * px), laidUnder = laid;
      vec3 under = ground;
      if (inBack) {
        vec4 c = paint(j, back, bid, ci0, trap, pxc, J, w, mirror);
        float x = clamp(c.a * shown, 0., 1.);
        ground = mix(ground, c.rgb, x);
        laid = mix(laid, 1., x);
      }
      if (inFront) {
        vec4 c = paint(j, front, fid, ci0, trap, pxc, J, w, mirror);
        float x = clamp(c.a * shown, 0., 1.);
        ground = mix(ground, c.rgb, x);
        laid = mix(laid, 1., x);
      }
      // front order fades in by spill over the cell's own paint, so a morph swaps it unseen where spill is nothing
      if (fr && t6.w < 1.) {
        vec4 c = paint(j, own, cell.zw, ci0, trap, pxc, J, w, mirror);
        float x = clamp(c.a * shown, 0., 1.);
        ground = mix(mix(under, c.rgb, x), ground, t6.w);
        laid = mix(mix(laidUnder, 1., x), laid, t6.w);
      }
    }
#endif
`,
      ...(ht
        ? {
            walks: `#ifdef HTS
  // the picture's one screen: the pixel's nearest dot, its offset from the dot's centre (sd, in screen units) and the
  // dot's centre walked down the chain beside the pixel (t)
  float sp = 2. / uScreen.y;
  vec4 sn = oblique(rot(-uScreen.z) * uv / sp, uScreen.w > .5 ? vec2(.5, .8660254) : vec2(0, 1));
  vec2 sd = rot(uScreen.z) * sn.xy * sp;
  Walk t = walk(uv - sd, start);
#endif
`,
            level: `    // the level (pass 0), then, where it has a halftone (h0.x its amount), drawn again at its nearest
    // dot's centre: on its own lattice from where the pixel's walk came in (pass 1), or on the screen by the dot's
    // walk t (pass 2), which reaches this level here or not at all (in another sub-chain: no dot) and steps on beside
    // the pixel's walk either way. One level call for the passes, so it is inlined once, and only as many passes as
    // are drawn.
    vec4 h0 = row(s.j, ${layout.deco} + 3), h1 = row(s.j, ${layout.deco} + 4);
    bool screened = h0.y > .5, here = false;
    int dots = h0.x > 0. && !screened ? 1 : 0, steps = 0;
#ifdef HTS
    here = h0.x > 0. && screened && t.j == s.j;
    steps = uScreen.x > 0. && t.j >= 0 ? 1 : 0;
#endif
    Walk s0 = s;
    vec3 g0 = ground, gd = vec3(0);
    Draw d, dd = Draw(0., vec3(0), 1., 0., 0.);
    for (int k = 0; k < 1 + dots + steps; k++) {
      int pass = k == 0 ? 0 : k == dots ? 1 : 2;
      Walk w = s0;
#ifdef HTS
      if (pass == 2) w = t;
#endif
      // a lattice dot keeps the colour field's shift at its cell, which the pixel's step read
      if (pass == 1) w.shift = s.shift;
      vec3 g = pass == 0 ? ground : vec3(0);
      Draw e = level(w, g, i, pass == 1 ? h0.z : 0., pass == 0 ? 0. : h1.z);
      if (pass == 0) {
        s = w;
        ground = g;
        d = e;
      } else if (pass == 1 || here) {
        dd = e;
        gd = g;
      }
#ifdef HTS
      if (pass == 2) t = w;
#endif
    }
    if (h0.x > 0.) {
      // the dot's size v, what the level drew at its centre, its line at reach and its paint: its radius size times
      // half the gap to the next dot times the root of v, over a pixel (aa) at its edge, a dot under a pixel fading as
      // it shrinks, and its light faded by v as far as fade. The line's share of it is light and the paint's share
      // paint, in the dot centre's colours, and the level's own draw crossfades into the dot's by amount.
      float v = clamp(dd.a + dd.laid, 0., 1.), gap = .5 / h0.z, dist = dd.off, aa = 2. / uRes.y / dd.px;
#ifdef HTS
      if (screened) {
        gap = .5 * sp;
        dist = length(sd);
        aa = 2. / uRes.y;
      }
#endif
      float r = gap * h0.w * sqrt(v);
      float m = (1. - smoothstep(r - aa, r + aa, dist)) * min(r / aa, 1.) * mix(1., v, h1.x);
      float sf = clamp(dd.laid / max(dd.a + dd.laid, 1e-4), 0., 1.);
      float a = mix(d.a, m * (1. - sf), h0.x);
      d.col = mix(d.col * d.a, dd.col * m * (1. - sf), h0.x) / max(a, 1e-6);
      d.a = a;
      ground = mix(ground, mix(g0, dd.laid > 0. ? gd / dd.laid : g0, m * sf), h0.x);
    }
`,
          }
        : {}),
    }
  },
  texels: 5,
  pack: ({ fill, halftone }, put) => {
    // a level without a fill draws its line alone, and one without a halftone (its amount 0) as itself
    put(0, fill?.amount.value ?? 0, fill?.line.value ?? 1, fill?.tone.value ?? 0, fill?.bands.value ?? 0)
    if (fill) {
      put(1, fill.step.value, fill.metal.value, fill.light.value * RAD, fill.shade.value)
      put(2, fill.ramp.value, fill.alternate.value, fill.front ? 1 : 0, 0)
    }
    if (halftone) {
      const { amount, grid, pitch, size, fade, turn, reach } = halftone
      put(3, amount.value, GRIDS.indexOf(grid), pitch.value, size.value)
      put(4, fade.value, turn.value * RAD, reach.value, 0)
    }
  },
}

// A fill that is not there, beside one that is: fill 0 and line 1, which draw the line alone, with the fill's light
// and shade.
const unfilled = ({ light, shade }: Fill): Fill => ({
  amount: { value: 0 },
  line: { value: 1 },
  tone: { value: 0 },
  bands: { value: 0 },
  step: { value: 0 },
  metal: { value: 0 },
  light,
  shade,
  ramp: { value: 0 },
  alternate: { value: 0 },
})

// A fill one side lacks morphs from one that draws as if it were not there; front order swaps at the middle, where
// spill dips to nothing (morph.ts)
export function mixFill(a: Fill | undefined, b: Fill | undefined, t: number, k: KnobMorph): Fill | undefined {
  if (!a && !b) return undefined
  const [fa, fb] = [a ?? unfilled(b!), b ?? unfilled(a!)]
  const front = t < 0.5 ? fa.front : fb.front
  return {
    amount: k(fa.amount, fb.amount),
    line: k(fa.line, fb.line),
    tone: k(fa.tone, fb.tone),
    bands: k(fa.bands, fb.bands),
    step: k(fa.step, fb.step),
    metal: k(fa.metal, fb.metal),
    light: k(fa.light, fb.light),
    shade: k(fa.shade, fb.shade),
    ramp: k(fa.ramp, fb.ramp),
    alternate: k(fa.alternate, fb.alternate),
    ...(front ? { front } : {}),
  }
}

// A halftone one side lacks morphs from amount 0, with the other side's knobs and grid; a change of grid swaps at the
// middle, where its amount dips to nothing (morph.ts)
export function mixHalftone(
  a: Halftone | undefined,
  b: Halftone | undefined,
  t: number,
  k: KnobMorph,
): Halftone | undefined {
  if (!a && !b) return undefined
  const [ha, hb] = [a ?? { ...b!, amount: { value: 0 } }, b ?? { ...a!, amount: { value: 0 } }]
  return {
    amount: k(ha.amount, hb.amount),
    grid: t < 0.5 ? ha.grid : hb.grid,
    pitch: k(ha.pitch, hb.pitch),
    size: k(ha.size, hb.size),
    fade: k(ha.fade, hb.fade),
    turn: k(ha.turn, hb.turn),
    reach: k(ha.reach, hb.reach),
  }
}
