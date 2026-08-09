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
    // #2248: `strikes` omitted deliberately — this fixture pins the pure scalar
    // `maxStrikes` (legacy) path, which stays supported once `strikes` also
    // drives a per-rung ladder (see the "progressive escalation ladder" suite
    // below). A fixture declaring BOTH now takes the per-rung path instead.
    const { dir, cleanup } = stage([PASS_ENTRY, FAIL_ENTRY, FAIL_ENTRY, FAIL_ENTRY], {
      e2ePolicy: { escalation: { maxStrikes: 3 } },
    })
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
    // #2248: see comment above — scalar-only fixture, legacy path.
    const { dir, cleanup } = stage([PASS_ENTRY, FAIL_ENTRY, FAIL_ENTRY], {
      e2ePolicy: { escalation: { maxStrikes: 3 } },
    })
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

// #2248 (AC-2248.1/2): the ladder declared in escalation.strikes was DECLARATIVE
// ONLY — schema-validated but consumed by nothing; every consecutive count that
// crossed ANY threshold produced the exact same generic message (today: always
// "force the full suite / escalate to needs-human", regardless of which rung was
// actually crossed). RED: assert the rung-specific action word appears (and the
// OTHER rungs' words do not) at each of the three canonical thresholds.
describe('progressive escalation ladder (#2248)', () => {
  const LADDER = { escalation: { strikes: [2, 3, 5], maxStrikes: 5 } }

  it('AC-2248.1/2: 1 consecutive REGRESSION at strikes [2,3,5] stays below rung 1 (no escalation)', () => {
    const { dir, cleanup } = stage([PASS_ENTRY, FAIL_ENTRY], LADDER)
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('AC-2248.1/2: 2 consecutive REGRESSION at strikes [2,3,5] triggers rung 1 (widen scope)', () => {
    const { dir, cleanup } = stage([PASS_ENTRY, FAIL_ENTRY, FAIL_ENTRY], LADDER)
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/widen/i)
      expect(r.stderr).not.toMatch(/full suite/i)
      expect(r.stderr).not.toMatch(/hard stop/i)
    } finally {
      cleanup()
    }
  })

  it('AC-2248.1/2: 3 consecutive REGRESSION at strikes [2,3,5] triggers rung 2 (force the full suite)', () => {
    const { dir, cleanup } = stage([PASS_ENTRY, FAIL_ENTRY, FAIL_ENTRY, FAIL_ENTRY], LADDER)
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/full suite/i)
      expect(r.stderr).not.toMatch(/widen/i)
      expect(r.stderr).not.toMatch(/hard stop/i)
    } finally {
      cleanup()
    }
  })

  it('AC-2248.1/2: 5 consecutive REGRESSION at strikes [2,3,5] triggers rung 3 (hard stop + needs-human)', () => {
    const { dir, cleanup } = stage(
      [PASS_ENTRY, FAIL_ENTRY, FAIL_ENTRY, FAIL_ENTRY, FAIL_ENTRY, FAIL_ENTRY],
      LADDER,
    )
    try {
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/hard stop/i)
      expect(r.stderr).toMatch(/needs-human/i)
      expect(r.stderr).not.toMatch(/widen/i)
    } finally {
      cleanup()
    }
  })
})
