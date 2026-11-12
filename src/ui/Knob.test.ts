import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAP, capped, wheelSteps, wheelTurn } from './Knob'

// a mouse's notch up, as Chrome sends it in pixels
const notch = { deltaX: 0, deltaY: -100, deltaMode: 0, shiftKey: false }

describe('the wheel', () => {
  // the animation frames, run by hand
  let frames: (() => void)[] = []
  const nextFrame = () => frames.splice(0).forEach((f) => f())
  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => frames.push(f))
  })
  afterEach(() => {
    nextFrame()
    vi.unstubAllGlobals()
  })

  it('shift turns a fifth of a notch', () => {
    expect(wheelSteps(notch)).toBe(1)
    expect(wheelSteps({ ...notch, shiftKey: true })).toBeCloseTo(0.2, 12)
    // a line's turn, and shift sent as a sideways turn
    expect(wheelSteps({ ...notch, deltaY: 3, deltaMode: 1 })).toBe(-1)
    expect(wheelSteps({ ...notch, deltaY: 0, deltaX: -100, shiftKey: true })).toBeCloseTo(0.2, 12)
  })

  it("a frame's wheel is capped at 4 notches each way", () => {
    expect(CAP).toBe(4)
    expect(capped(0, 3)).toBe(3)
    expect(capped(3, 3)).toBe(1)
    expect(capped(4, 1)).toBe(0)
    expect(capped(-3.5, -2)).toBe(-0.5)
    expect(capped(4, -1)).toBe(-1)
    // a trackpad's stream in one frame, 30 pixels at a time: 4 notches land and the rest is dropped
    const landed = Array.from({ length: 20 }, () => wheelTurn({ ...notch, deltaY: -30 }))
    expect(landed.reduce((a, b) => a + b, 0)).toBeCloseTo(4, 12)
    expect(landed.slice(-5)).toEqual([0, 0, 0, 0, 0])
    nextFrame()
    expect(Array.from({ length: 6 }, () => wheelTurn({ ...notch, deltaY: 100 }))).toEqual([-1, -1, -1, -1, 0, 0])
  })

  it('notches a frame apart each land whole', () => {
    const landed = Array.from({ length: 12 }, () => {
      const steps = wheelTurn(notch)
      nextFrame()
      return steps
    })
    expect(landed).toEqual(Array(12).fill(1))
  })
})
