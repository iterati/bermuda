import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// The files that launch a browser: Chrome with swiftshader draws on the CPU, so beside each other, or beside the
// pure files, they starve one another into timeouts. They run one at a time, after the pure files.
const root = fileURLToPath(new URL('.', import.meta.url))
const tests = globSync('src/**/*.test.ts', { cwd: root })
const browser = tests.filter((f) => readFileSync(join(root, f), 'utf8').includes("from 'puppeteer-core'"))

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        { extends: true, test: { name: 'pure', include: tests, exclude: browser } },
        {
          extends: true,
          test: { name: 'browser', include: browser, fileParallelism: false, sequence: { groupOrder: 1 } },
        },
      ],
    },
  }),
)
