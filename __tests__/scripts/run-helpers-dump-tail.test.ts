// SPDX-License-Identifier: Apache-2.0
// #2032: a failed check's captured-output dump must preserve the TAIL. Across four
// episodes (#2027) the vitest error line — always at the END of a 100k-line capture —
// was unrecoverable from the CI job log, because GitHub caps a step's log and drops
// what comes last. Emitting the tail (not the head) keeps the actual cause visible.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const HELPERS = resolve('scripts/lib/run-helpers.mjs')

/**
 * Run `runCheck` against a node one-liner that prints `lines` numbered lines and exits 1,
 * returning the gate's combined output.
 */
function runFailingCheck(lines: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-dump-tail-'))
  try {
    const driver = join(dir, 'driver.mjs')
    writeFileSync(
      driver,
      `import { runCheck } from ${JSON.stringify(HELPERS)}
runCheck('noisy', process.execPath, [
  '-e',
  'for (let i = 1; i <= ${lines}; i++) console.log("line " + i); process.exit(1)',
])
`,
    )
    const r = spawnSync(process.execPath, [driver], { encoding: 'utf-8' })
    return (r.stdout ?? '') + (r.stderr ?? '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('#2032 failed-check dump preserves the output tail', () => {
  it('keeps the LAST lines of a huge capture (and says it truncated the head)', () => {
    const out = runFailingCheck(5000)
    expect(out).toContain('line 5000')
    expect(out).toMatch(/truncated/i)
    // The head is what gets dropped — that is the whole point of a tail dump.
    expect(out).not.toContain('line 1\n')
  })

  it('emits a short capture in full, unchanged', () => {
    const out = runFailingCheck(5)
    expect(out).toContain('line 1')
    expect(out).toContain('line 5')
    expect(out).not.toMatch(/truncated/i)
  })
})
