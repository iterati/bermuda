// Deco: step A's fills and their metal. A level's fill paints its cells' shapes in bands in from their edges, the
// line over it keeping as much of itself as the fill's line, and metal lights each facet by its slope on the screen.
// Its preprocessor text is in every program, FILL and METAL defined only where the program holds fill or metal; the
// front order's text runs inside Tiling's spill loop and the core's own cell, and metal's flag ahead of the stretch.
// Its row texels, from its first (FILL_TEXEL):
//   0: the fill's amount, line, tone, bands (a level without a fill: 0, 1, 0, 0)
//   1: its step, metal, light (radians), shade
//   2: its ramp, alternate, front order (0 or 1), unused
import { allLevels, type Fill } from '../scene'
import { RAD, VARIANT_TEXELS, type Engine, type KnobMorph, type Layout } from './engine'

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

export const deco: Engine = {
  name: 'deco',
  parts: ['fill', 'metal'],
  // a fill brings metal even at metal 0, and metal the stretch, as metal reads its slope on the screen
  needs: (scene, add) => {
    for (const { level } of allLevels(scene.levels))
      if (level.fill) {
        add('fill')
        add('metal')
        add('stretch')
      }
  },
  glsl: (has, layout) => ({
    defines: has('metal') ? '#define METAL\n' : has('fill') ? '#define FILL\n' : '',
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
`,
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
`,
  }),
  texels: 3,
  pack: ({ fill }, put) => {
    // a level without a fill draws its line alone
    put(0, fill?.amount.value ?? 0, fill?.line.value ?? 1, fill?.tone.value ?? 0, fill?.bands.value ?? 0)
    if (!fill) return
    put(1, fill.step.value, fill.metal.value, fill.light.value * RAD, fill.shade.value)
    put(2, fill.ramp.value, fill.alternate.value, fill.front ? 1 : 0, 0)
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
