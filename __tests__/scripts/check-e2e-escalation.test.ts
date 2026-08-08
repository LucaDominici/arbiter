// SPDX-License-Identifier: Apache-2.0
// #2043 — AC-2043.5/6 RED: a gate must read the append-only e2e JSONL ledger and
// trigger escalation when CONSECUTIVE failures cross the configured threshold.
// RED: no such gate exists today — the 2-strike rule is hardcoded in the ship tick
// prompt and the ladder is within-run only, so a run with 3 consecutive failing
// ledger entries passes (nothing reads the ledger).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-e2e-escalation.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function stage(entries: string[], arbiter?: unknown): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-escalation-'))
  if (entries.length > 0) {
    const ledgerDir = join(dir, '.arbiter')
    mkdirSync(ledgerDir, { recursive: true })
    writeFileSync(join(ledgerDir, 'e2e-ledger.jsonl'), entries.join('\n') + '\n', 'utf-8')
  }
  if (arbiter !== undefined) {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(arbiter, null, 2))
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const PASS_ENTRY = JSON.stringify({ verdict: 'PASS', scope: 'initial' })
const FAIL_ENTRY = JSON.stringify({ verdict: 'REGRESSION', scope: 'initial' })

describe('e2e escalation ledger gate (#2043)', () => {
  it('AC-2043.5/6: 3 consecutive failures with threshold 3 escalates (exit 1)', () => {
    const { dir, cleanup } = stage(
      [PASS_ENTRY, FAIL_ENTRY, FAIL_ENTRY, FAIL_ENTRY],
      { e2ePolicy: { escalation: { strikes: [2, 3, 5], maxStrikes: 3 } } },
    )
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/escalat/i)
      expect(r.stderr).toContain('3')
    } finally {
      cleanup()
    }
  })

  it('AC-2043.5/6: 2 consecutive failures below threshold 3 does not escalate (exit 0)', () => {
    const { dir, cleanup } = stage(
      [PASS_ENTRY, FAIL_ENTRY, FAIL_ENTRY],
      { e2ePolicy: { escalation: { strikes: [2, 3, 5], maxStrikes: 3 } } },
    )
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('AC-2043.5/6: defaults to the 2-strike ladder when arbiter.json has no e2ePolicy', () => {
    const { dir, cleanup } = stage([PASS_ENTRY, FAIL_ENTRY, FAIL_ENTRY])
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('SKIPs (exit 0) when no ledger exists yet', () => {
    const { dir, cleanup } = stage([])
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
