// Backgrounds: the soak, Frankenthaler's soak-stain, pools of pigment on raw canvas. The core's backgrounds are none,
// flat and gradient.
import type { Engine } from './engine'

export const backgrounds: Engine = {
  name: 'backgrounds',
  parts: ['soak'],
  needs: (scene, add) => {
    if (scene.background?.kind === 'soak') add('soak')
  },
  glsl: (has) =>
    has('soak')
      ? {
          afterNoise: `float fbm(vec2 p) {
  float v = 0., a = .5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = rot(.5) * p * 2.03 + 17.; a *= .5; }
  return v;
}
`,
          background: ` else {
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
  }`,
        }
      : {},
}
