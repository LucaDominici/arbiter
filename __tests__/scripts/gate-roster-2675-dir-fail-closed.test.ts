// SPDX-License-Identifier: Apache-2.0
// #2675 Codex round-1 — the --dir flag added to check-pr-size-gate.mjs,
// check-suppression-expiry.mjs, and check-suppression-rationale.mjs must be fail-closed: a
// bare --dir (no value) or a --dir naming a nonexistent path / a file (not a directory) used to
// fall back to process.cwd() SILENTLY, letting the caller's own fixture-less SKIP paths report
// clean on the LIVE repo instead of refusing an unusable explicit scan-root request.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'dir-fail-closed-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SCRIPTS = [
  'scripts/check-pr-size-gate.mjs',
  'scripts/check-suppression-expiry.mjs',
  'scripts/check-suppression-rationale.mjs',
]

describe('#2675 — --dir refuses a bare/dangling/non-directory value (never a silent cwd fallback)', () => {
  for (const script of SCRIPTS) {
    it(`${script}: a bare trailing --dir exits 2 with a clear message`, () => {
      const r = spawnSync('node', [resolve(script), '--dir'], { encoding: 'utf-8' })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/--dir requires a path argument/)
    })

    it(`${script}: a --dir naming a nonexistent path exits 2 with a clear message`, () => {
      withTmp((dir) => {
        const r = spawnSync('node', [resolve(script), '--dir', join(dir, 'does-not-exist')], {
          encoding: 'utf-8',
        })
        expect(r.status).toBe(2)
        expect(r.stderr).toMatch(/does not exist or is not a directory/)
      })
    })

    it(`${script}: a --dir naming a file (not a directory) exits 2 with a clear message`, () => {
      withTmp((dir) => {
        const filePath = join(dir, 'a-file.txt')
        writeFileSync(filePath, 'x')
        const r = spawnSync('node', [resolve(script), '--dir', filePath], { encoding: 'utf-8' })
        expect(r.status).toBe(2)
        expect(r.stderr).toMatch(/does not exist or is not a directory/)
      })
    })
  }
})
