// SPDX-License-Identifier: Apache-2.0
// #2671 — the emitted check-inline-suppressions.mjs must not treat a
// directive-shaped string INSIDE a string literal (e.g. the check-no-pii hook's
// own advisory text, which prints `// arbiter-suppress(INV-12, until=YYYY-MM-DD, ...)`
// as help output) as a real, malformed directive. Coach's locally-patched copy
// added this guard; arbiter's own template only dodges the false positive today
// via a `${"//"}` interpolation trick in check-no-pii.mjs.ejs. Inversion: a real
// `//` comment directive is still enforced (guard not disarmed).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(tpl: string): string {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L1',
  }) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}

function stageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inline-suppr-'))
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  writeFileSync(
    join(dir, 'scripts', 'check-inline-suppressions.mjs'),
    render('scripts/check-inline-suppressions.mjs.ejs'),
  )
  writeFileSync(
    join(dir, 'scripts', 'lib', 'glob-walk.mjs'),
    render('scripts/lib/glob-walk.mjs.ejs'),
  )
  return dir
}

function runCheck(dir: string): number {
  return (
    spawnSync('node', [join(dir, 'scripts', 'check-inline-suppressions.mjs'), '.'], {
      cwd: dir,
      encoding: 'utf-8',
    }).status ?? 1
  )
}

describe('#2671 emitted check-inline-suppressions skips directive text inside string literals', () => {
  it('PASSES a directive-shaped string embedded in a template literal (advisory text, not a real suppression)', () => {
    const dir = stageDir()
    try {
      writeFileSync(
        join(dir, 'advisory.ts'),
        'export const HELP = `  // arbiter-suppress(INV-12, until=YYYY-MM-DD, reason="known-safe test value", owner=you)\\n`\n',
      )
      expect(runCheck(dir)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still FAILS a real // comment directive with an invalid date (guard not disarmed)', () => {
    const dir = stageDir()
    try {
      writeFileSync(
        join(dir, 'real.ts'),
        '// arbiter-suppress(INV-12, until=YYYY-MM-DD, reason="documented test fixture", owner=team)\n' +
          'export const sample = 1\n',
      )
      expect(runCheck(dir)).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
