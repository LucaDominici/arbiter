// SPDX-License-Identifier: Apache-2.0
// #1428 — `arbiter doc-set` is a THIN wrapper over the SSOT engine (scripts/check-doc-set.mjs).
// It shells the engine via the INV-12 runCli helper, forwards passthrough args, and surfaces
// the engine's INV-53 exit code. There is exactly one engine — never a second presence auditor.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDocSet } from '../../src/commands/doc-set.js'

const MANIFEST = `version: '1.0.0'
checks:
  - id: DOC-README
    path: README.md
    tier: mandatory
    applies: always
  - id: DOC-CONTRIBUTING
    path: CONTRIBUTING.md
    tier: recommended
    applies: always
`

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'doc-set-cmd-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), MANIFEST)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runDocSet (#1428 thin wrapper)', () => {
  it('--check runs the engine advisory and exits 0 even with a mandatory gap (no day-1 redness)', () => {
    // README missing → mandatory gap, but advisory (no --strict) → exit 0.
    const res = runDocSet({ repo: dir, check: true })
    expect(res.exitCode).toBe(0)
  })

  it('exits 0 when all applicable docs are present', () => {
    writeFileSync(join(dir, 'README.md'), '# r\n')
    writeFileSync(join(dir, 'CONTRIBUTING.md'), '# c\n')
    const res = runDocSet({ repo: dir, check: true })
    expect(res.exitCode).toBe(0)
  })

  it('forwards --strict so a missing mandatory doc HARD-FAILs (exit 1)', () => {
    // README missing + --strict → exit 1.
    const res = runDocSet({ repo: dir, args: ['--strict'] })
    expect(res.exitCode).toBe(1)
  })

  it('no manifest → SKIP (exit 0), never a manufactured fail', () => {
    const empty = mkdtempSync(join(tmpdir(), 'doc-set-cmd-empty-'))
    try {
      const res = runDocSet({ repo: empty, check: true })
      expect(res.exitCode).toBe(0)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
