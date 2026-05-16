// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { sanitizeTaskId as srcSanitize } from '../../src/review/dispatch.js'
// Hook lib is plain JS module; importable via ESM relative path
import { sanitizeTaskId as hookSanitize } from '../../.claude/hooks/lib.mjs'

const FIXTURES = [
  '#694',
  '..',
  '../../etc/passwd',
  'foo/bar',
  '',
  'safe_id-1',
  'unicodeé',
  'a.b*c',
  '#abc[\\]',
  'a'.repeat(100),
]

describe('sanitizeTaskId parity (src ↔ hook) (#694)', () => {
  for (const fx of FIXTURES) {
    it(`identical output for ${JSON.stringify(fx).slice(0, 32)}`, () => {
      expect(hookSanitize(fx)).toBe(srcSanitize(fx))
    })
  }
})
