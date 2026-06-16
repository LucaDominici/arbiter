// SPDX-License-Identifier: Apache-2.0
// RED phase (#1410): check-orchestrator-coverage.mjs verifies every
// scripts/check-*.mjs is reachable from scripts/check-all.mjs — directly OR
// transitively (the check-anti-fake-green GUARDS aggregate) — or is on a
// rationale'd allowlist. ADVISORY in this wave: report-only, always exit 0.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  computeOrphanChecks,
  loadCoverageAllowlist,
} from '../../scripts/check-orchestrator-coverage.mjs'

const SCRIPT = resolve('scripts/check-orchestrator-coverage.mjs')

describe('check-orchestrator-coverage.mjs (#1410, advisory)', () => {
  it('exits 0 (advisory — report-only, never blocks the gate)', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: '.', timeout: 20000 })
    expect(r.status).toBe(0)
  })

  it('flags a check-*.mjs that is referenced NOWHERE (direct, transitive, or allowlist)', () => {
    const checkFiles = ['check-foo.mjs', 'check-bar.mjs']
    const checkAllSrc = "runCheck('foo', 'node', ['scripts/check-foo.mjs'])"
    const transitiveSrcs = [''] // no anti-fake-green guard refs
    const allowlist = new Set<string>()
    const orphans = computeOrphanChecks(checkFiles, checkAllSrc, transitiveSrcs, allowlist)
    expect(orphans).toContain('check-bar.mjs')
    expect(orphans).not.toContain('check-foo.mjs')
  })

  it('does NOT flag a check resolved TRANSITIVELY (e.g. via the anti-fake-green GUARDS array)', () => {
    const checkFiles = ['check-guarded.mjs']
    const checkAllSrc = "runCheck('afg', 'node', ['scripts/check-anti-fake-green.mjs'])"
    const transitiveSrcs = ["GUARDS = [{ script: 'check-guarded.mjs' }]"]
    const orphans = computeOrphanChecks(checkFiles, checkAllSrc, transitiveSrcs, new Set())
    expect(orphans).not.toContain('check-guarded.mjs')
  })

  it('does NOT flag an allowlisted check', () => {
    const checkFiles = ['check-orphan.mjs']
    const orphans = computeOrphanChecks(checkFiles, '', [''], new Set(['check-orphan.mjs']))
    expect(orphans).not.toContain('check-orphan.mjs')
  })

  it('never flags check-all.mjs itself', () => {
    const orphans = computeOrphanChecks(['check-all.mjs'], '', [''], new Set())
    expect(orphans).not.toContain('check-all.mjs')
  })

  it('loads a rationale-bearing allowlist (every entry has a non-empty rationale)', () => {
    const { entries, problems } = loadCoverageAllowlist()
    expect(problems).toEqual([])
    for (const e of entries) {
      expect(typeof e.script).toBe('string')
      expect(e.rationale.trim().length).toBeGreaterThan(0)
    }
  })

  it('the SELF repo is coherent: every real orphan is covered by the allowlist (advisory clean)', () => {
    // Running against the real arbiter tree, the report must list zero UN-allowlisted orphans.
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: '.', timeout: 20000 })
    const out = `${r.stdout}${r.stderr}`
    expect(out).toMatch(/orchestrator-coverage/i)
    // Advisory output reports "0 un-allowlisted orphan(s)" when coherent.
    expect(out).toMatch(/0 un-allowlisted orphan|all .* covered|OK/i)
  })
})
