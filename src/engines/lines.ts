// Lines: dots, a line of dots round each cell's outline, fading from one whole count to the next and crawling round
// it. The core's line kinds are glow, smooth, hard and band.
import type { Scene } from '../scene'
import type { Engine, KnobMorph } from './engine'

export const lines: Engine = {
  name: 'lines',
  parts: ['dots'],
  needs: (scene, add) => {
    if (scene.line.kind === 'dots' || scene.line.dots) add('dots')
  },
  glsl: (has) =>
    has('dots')
      ? {
          beforeLine: `// one dotted line of n dots round the cell: dash = (turn round the cell, radius from its middle in line units); each
// dot a dash size of the gap to the next long and w wide, crawled phase dots along
float dotted(float d, vec4 dash, float n, float phase, float w, float f) {
  float gap = 2. * PI * dash.y / n;
  float along = (fract(dash.x * n + phase) - .5) * gap;
  float q = length(vec2(d, max(abs(along) - max(.5 * dash.w * gap - w, 0.), 0.)));
  return pow(1. - smoothstep(0., w, q), f);
}

`,
          lineTail: `  if (kind < 3.5) return 1. - smoothstep(w, w * (1. + f), d);
  float n = max(floor(dash.z), 1.);
  return mix(dotted(d, dash, n, phase, w, f), dotted(d, dash, n + 1., phase, w, f), clamp(dash.z - n, 0., 1.));`,
        }
      : {},
}

// dots one side lacks morph from the other side's, which that side does not draw
export function mixDots(a: Scene['line'], b: Scene['line'], k: KnobMorph): Scene['line']['dots'] {
  const dots = a.dots ?? b.dots
  if (!dots) return undefined
  const [da, db] = [a.dots ?? dots, b.dots ?? dots]
  return { count: k(da.count, db.count), size: k(da.size, db.size), crawl: k(da.crawl, db.crawl) }
}
