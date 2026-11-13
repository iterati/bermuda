// The folders: every built-in look in exactly one of them, and LOOKS running through them in their order, which keys
// 1-0 and the MIDI slots count by.
import { expect, it } from 'vitest'
import { FOLDERS, LOOKS } from './looks'

it('puts every look in exactly one folder, LOOKS in folder order', () => {
  for (const look of LOOKS)
    expect(
      FOLDERS.filter((f) => f.looks.some((l) => l.name === look.name)).map((f) => f.name),
      look.name,
    ).toHaveLength(1)
  expect(new Set(LOOKS.map((l) => l.name)).size).toBe(LOOKS.length)
  expect(FOLDERS.flatMap((f) => f.looks)).toEqual(LOOKS)
  expect(new Set(FOLDERS.map((f) => f.name)).size).toBe(FOLDERS.length)
})
