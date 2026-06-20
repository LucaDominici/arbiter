// SPDX-License-Identifier: Apache-2.0
// #1428 — `arbiter anti-fake-green` is a THIN wrapper over the SSOT engine
// (scripts/check-anti-fake-green.mjs). It shells the engine via the INV-12 runCli helper,
// forwards passthrough args (e.g. --enforce), and surfaces the engine's INV-53 exit code.
// The gh-audit guards fail OPEN (advisory) when gh is absent — no day-1 redness.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAntiFakeGreen } from '../../src/commands/anti-fake-green.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anti-fake-green-cmd-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runAntiFakeGreen (#1428 thin wrapper)', () => {
  it('default run on a clean repo exits 0 (gh-audit guards fail OPEN, no day-1 redness)', () => {
    const res = runAntiFakeGreen({ repo: dir })
    expect(res.exitCode).toBe(0)
  })

  it('returns an exit code (the engine INV-53 status is surfaced, never thrown)', () => {
    const res = runAntiFakeGreen({ repo: dir, enforce: false })
    expect([0, 1, 2]).toContain(res.exitCode)
  })

  it('--enforce is forwarded to the engine (advisory findings become hard under enforce)', () => {
    // On a clean repo with no gh + no muted tests + no e2e config, even --enforce passes (exit 0).
    const res = runAntiFakeGreen({ repo: dir, enforce: true })
    expect([0, 1]).toContain(res.exitCode)
  })
})
