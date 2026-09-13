// SPDX-License-Identifier: Apache-2.0
// #2675 Codex round-2 — two residual ways the --dir fail-closed guard (round-1) could still
// silently fall back to process.cwd():
//   1. `--dir ''` — an empty string is not `undefined`, so it passed the round-1 check, and
//      `resolve('')` IS process.cwd(): the exact silent fallback round-1 set out to close.
//   2. A repeated `--dir <valid> --dir` (bare last) — `indexOf` reads the FIRST occurrence, so
//      the trailing bare flag was never seen; "last flag wins" is the only deterministic reading
//      of a repeated CLI flag, and a bare LAST occurrence must refuse, not fall through to an
//      earlier value.
// Parametrized over every entry point that reads --dir: the shared parseHelpAndDir consumers
// (scripts/lib/workflow-scan.mjs) and the three standalone anti-drift scripts.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'dir-empty-repeated-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// The 6 scripts that resolve --dir via the shared scripts/lib/workflow-scan.mjs parseHelpAndDir.
const PARSE_HELP_AND_DIR_CONSUMERS = [
  'scripts/check-workflow-runners.mjs',
  'scripts/check-docker-action-runner-safety.mjs',
  'scripts/check-workflow-test-integrity.mjs',
  'scripts/check-workflow-parallelism.mjs',
  'scripts/check-secret-presence.mjs',
  'scripts/check-continue-on-error.mjs',
]

// The 3 standalone anti-drift scripts with their own inline --dir parsing (#2675).
const STANDALONE_DIR_SCRIPTS = [
  'scripts/check-pr-size-gate.mjs',
  'scripts/check-suppression-expiry.mjs',
  'scripts/check-suppression-rationale.mjs',
]

const ALL_DIR_SCRIPTS = [...PARSE_HELP_AND_DIR_CONSUMERS, ...STANDALONE_DIR_SCRIPTS]

describe('#2675 Codex round-2 — --dir refuses an empty value and a repeated bare flag', () => {
  for (const script of ALL_DIR_SCRIPTS) {
    it(`${script}: --dir '' exits 2, never a silent cwd fallback`, () => {
      const r = spawnSync('node', [resolve(script), '--dir', ''], { encoding: 'utf-8' })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/--dir requires a path argument/)
    })

    it(`${script}: --dir <valid> --dir (bare last) exits 2 — last flag wins`, () => {
      withTmp((dir) => {
        const r = spawnSync('node', [resolve(script), '--dir', dir, '--dir'], {
          encoding: 'utf-8',
        })
        expect(r.status).toBe(2)
        expect(r.stderr).toMatch(/--dir requires a path argument/)
      })
    })
  }
})
