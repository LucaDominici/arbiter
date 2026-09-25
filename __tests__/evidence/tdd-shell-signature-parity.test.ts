// SPDX-License-Identifier: Apache-2.0
// #2898: the shell signature accepts leading horizontal whitespace before `FAIL:` and never
// spans a newline. The runtime list (src/evidence/tdd.ts) and the emitted list
// (src/templates/scripts/lib/_tdd-receipt.ejs, included by check-tdd-evidence and the
// skill-forced-eval hook) must accept and refuse the same inputs.
import { describe, it, expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { extractFailureIdentities, extractFailureSignature } from '../../src/evidence/tdd.js'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// The partial is plain JS declarations with no top-level side effects.
const emitted = runInNewContext(
  `(() => {\n${renderTemplate('scripts/lib/_tdd-receipt.ejs', makeConfig('/tmp/test'))}\nreturn { hasFailureSignature }\n})()`,
) as { hasFailureSignature: (log: string) => boolean }

const ACCEPT = [
  'FAIL: scanner did not report the expected violation',
  '  FAIL: stale project reaped (expected=1 actual=0)',
  '\tFAIL: tab-indented',
  'ok one\n  FAIL: second line indented\nok three',
  '\tFAIL:\ttab after the colon',
]
const REFUSE = [
  'FAIL:\n  x', // label on the next line: [ \t] never crosses \n
  '  FAIL: \n', // nothing after the colon on the same line
  'FAIL-safe mode enabled',
  '  FAIL-safe: fallback engaged',
  'FAILED: 3',
  '  FAIL <label> (expected=1 actual=0)', // colon-less stays refused (owner decision)
  'this FAIL: is prose mid-line',
  'FAIL x',
  'FAIL - label',
  'FAIL (2 failures)',
]

describe('#2898 shell failure signature', () => {
  it.each(ACCEPT)('runtime accepts %j as shell', (log) => {
    expect(extractFailureSignature(log)?.framework).toBe('shell')
  })
  it.each(REFUSE)('runtime refuses %j', (log) => {
    expect(extractFailureSignature(log)).toBeNull()
  })
  it.each([...ACCEPT, ...REFUSE])('runtime and emitted lists agree on %j', (log) => {
    expect(emitted.hasFailureSignature(log)).toBe(extractFailureSignature(log) !== null)
  })
  it('emitted list accepts every indented case', () => {
    expect(ACCEPT.filter((log) => !emitted.hasFailureSignature(log))).toEqual([])
  })
  it('keeps the identity of a column-0 receipt and trims an indented one to the same form', () => {
    expect(extractFailureIdentities('FAIL: stale project reaped')).toEqual([
      'FAIL: stale project reaped',
    ])
    expect(extractFailureIdentities('  FAIL: stale project reaped')).toEqual([
      'FAIL: stale project reaped',
    ])
  })
})
