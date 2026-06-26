// SPDX-License-Identifier: Apache-2.0
/**
 * #1542 / #1523 — root cause of the "complexity collector returns 0" gotcha.
 *
 * `debt-lib`'s metric collector shells out and parses each tool's JSON from
 * stdout. The shared `run()` helper used the Node default `spawnSync` maxBuffer
 * of 1 MiB. The `eslint <paths> --format json` output for the repo exceeds 1 MiB,
 * so the child aborted with ENOBUFS, stdout was silently truncated to ~1 MiB, the
 * truncated JSON failed to parse, and the collector's catch fell back to a value
 * of 0 — i.e. the complexityViolations ratchet was vacuously comparing 0 vs 0 and
 * could never see a real regression. This guard asserts `run()` (via the exported
 * `spawnOrSkip`) returns the FULL output for >1 MiB payloads instead of aborting.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnOrSkip } from '../../scripts/debt-lib.mjs'

const ROOT = join(__dirname, '..', '..')

describe('debt-lib spawnOrSkip — large-output buffering (#1542)', () => {
  it('returns the full child stdout for payloads larger than the 1 MiB default', () => {
    const bytes = 2_000_000
    const r = spawnOrSkip('probe', 'node', process.execPath, [
      '-e',
      `process.stdout.write('x'.repeat(${bytes}))`,
    ])
    expect(r).not.toBeNull()
    // Before the fix: status === null, error.code === 'ENOBUFS', stdout truncated.
    expect(r?.error).toBeUndefined()
    expect(r?.stdout.length).toBe(bytes)
  })
})

describe('debt-lib complexity ratchet scope (#1523/#1542)', () => {
  it('scans the scripts/ enforcement layer, not just src/', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'debt-lib.mjs'), 'utf8')
    // The complexityViolations collector must pass both paths so the gate code is
    // ratcheted alongside product code.
    expect(source).toMatch(/'eslint',\s*'src',\s*'scripts'/)
  })
})
