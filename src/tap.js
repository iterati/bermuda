// The tap, an audio worklet: each block's channels mixed to one, posted on with the audio clock's time of its first
// sample. A file the build emits beside its assets, so a page whose policy refuses blob: and data: scripts loads it.
/* global registerProcessor, AudioWorkletProcessor, currentTime */
registerProcessor(
  'bermuda-tap',
  class extends AudioWorkletProcessor {
    block = new Float32Array(1024)
    fill = 0
    at = 0
    process([input]) {
      if (!this.fill) this.at = currentTime
      for (let i = 0; i < 128; i++) {
        let s = 0
        for (const ch of input) s += ch[i]
        this.block[this.fill + i] = input.length ? s / input.length : 0
      }
      this.fill += 128
      if (this.fill === this.block.length) {
        this.port.postMessage({ at: this.at, samples: this.block }, [this.block.buffer])
        this.block = new Float32Array(1024)
        this.fill = 0
      }
      return true
    }
  },
)
