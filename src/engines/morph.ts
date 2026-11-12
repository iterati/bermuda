// Morph: what a morph's program draws beyond both ends' parts, the far end's palette mixes, palette and contour, and
// a lone level's crossfade into its other switches, a second chain each sample. needs' pair rule brings it, for a morph
// alone.
import type { Engine } from './engine'

export const morph: Engine = {
  name: 'morph',
  parts: ['morph'],
  glsl: (has) =>
    has('morph')
      ? {
          palette: `  if (uToward.y > 0. && uTowardMix[k] != uStopMix[k]) lab = mix(lab, segment(a, b, f, uTowardMix[k]), uToward.y);
`,
          colourAt: 'uToward.y > 0. ? mix(c, palette(idx + uToward.w + gShift), uToward.y) : c',
          pigment: 'uToward.y > 0. ? mix(c, palette(at + uToward.w), uToward.y) : c',
          drawn: `  if (uToward.y > 0.)
    a = mix(a, contour(c.d, k, rb, uToward.z + c.f * ringPhase, uToward.x, scale, lw, lf, dash, c.sgn * uCrawl.y),
            uToward.y);
`,
          crossChain: '2',
        }
      : {},
}
