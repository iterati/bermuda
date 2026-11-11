// OKLCh on the CPU: filling palette stops from iq's cosine presets, and the swatches the controls show.
// The shader holds the same OKLab to sRGB conversion (shader.ts).
import type { Scene } from './scene'

type Vec3 = [number, number, number]
type Stop = Scene['palette']['stops'][number]

// iq's cosine palettes, a + b·cos(2π(c·t + d)), as the Tapestries used them
export const COSINES: Record<string, [Vec3, Vec3, Vec3, Vec3]> = {
  rainbow: [
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
    [1, 1, 1],
    [0, 0.333, 0.667],
  ],
  warm: [
    [0.6, 0.6, 0.6],
    [0.4, 0.3, 0.35],
    [2, 2, 2],
    [0.85, 0.55, 0.25],
  ],
  dusk: [
    [0.744, 0.244, 0.577],
    [0.231, 0.395, 0.498],
    [0.759, 1.375, 0.932],
    [3.477, 6.066, 1.898],
  ],
  ice: [
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
    [1, 1, 1],
    [0.3, 0.2, 0.2],
  ],
  forest: [
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
    [1, 1, 0.5],
    [0.8, 0.9, 0.3],
  ],
  ember: [
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
    [1, 0.7, 0.4],
    [0, 0.15, 0.2],
  ],
}

const cosine = ([a, b, c, d]: [Vec3, Vec3, Vec3, Vec3], t: number): Vec3 =>
  [0, 1, 2].map((i) => Math.min(1, Math.max(0, a[i] + b[i] * Math.cos(2 * Math.PI * (c[i] * t + d[i]))))) as Vec3

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function srgbToOklch(rgb: Vec3): Vec3 {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return [L, Math.hypot(A, B), (h + 360) % 360]
}

export function oklchToSrgb([L, C, h]: Vec3): Vec3 {
  const A = C * Math.cos((h * Math.PI) / 180)
  const B = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => toGamma(Math.min(1, Math.max(0, c)))) as Vec3
}

export const css = (lch: Vec3) => `rgb(${oklchToSrgb(lch).map((c) => Math.round(c * 255))})`

// Sample a cosine preset at evenly spaced stops, each segment mixing the short way round.
export function stopsFromCosine(name: string, count: number): Stop[] {
  return Array.from({ length: count }, (_, i) => {
    const [L, C, h] = srgbToOklch(cosine(COSINES[name], i / count))
    return {
      at: i / count,
      lch: [{ value: round(L) }, { value: round(Math.min(C, 0.37)) }, { value: Math.round(h) }],
      mix: 'short',
    }
  })
}

const round = (v: number) => Math.round(v * 1000) / 1000

// The palette at index t, as the shader's palette() works it out, for the controls' gradient bar.
export function paletteAt(palette: Scene['palette'], t: number): Vec3 {
  const { stops } = palette
  t -= Math.floor(t)
  let k = stops.length - 1
  stops.forEach((s, i) => {
    if (s.at <= t) k = i
  })
  const k2 = k + 1 >= stops.length ? 0 : k + 1
  const a = stops[k]
  const b = stops[k2]
  const a1 = k2 <= k ? b.at + 1 : b.at
  const f = Math.min(1, Math.max(0, ((t < a.at ? t + 1 : t) - a.at) / Math.max(a1 - a.at, 1e-5)))
  const [ha, hb] = [a.lch[2].value + palette.hue.value, b.lch[2].value + palette.hue.value]
  const L = a.lch[0].value + (b.lch[0].value - a.lch[0].value) * f
  const lightness = Math.min(1, Math.max(0, 0.5 + (L - 0.5) * palette.contrast.value))
  if (a.mix === 'straight') {
    const lab = (s: Stop, h: number) => [
      s.lch[1].value * Math.cos((h * Math.PI) / 180),
      s.lch[1].value * Math.sin((h * Math.PI) / 180),
    ]
    const [xa, ya] = lab(a, ha)
    const [xb, yb] = lab(b, hb)
    const x = xa + (xb - xa) * f
    const y = ya + (yb - ya) * f
    return [lightness, Math.hypot(x, y), (Math.atan2(y, x) * 180) / Math.PI]
  }
  let dh = ((((hb - ha + 180) % 360) + 360) % 360) - 180
  if (a.mix === 'long') dh -= Math.sign(dh + 1e-6) * 360
  return [lightness, a.lch[1].value + (b.lch[1].value - a.lch[1].value) * f, ha + dh * f]
}

export const gradient = (palette: Scene['palette']) =>
  `linear-gradient(90deg, ${Array.from({ length: 33 }, (_, i) => css(paletteAt(palette, i / 32))).join(', ')})`
