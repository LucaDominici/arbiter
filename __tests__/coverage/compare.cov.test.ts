// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { runCompare, type CompareResult } from '../../src/commands/compare.js'
import type { GraphSnapshot } from '../../src/graph/model.js'

// ─── Fixture helpers ───────────────────────────────────────────────────────────

const created: string[] = []

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'compare-cov-'))
  created.push(dir)
  return dir
}

function writeGraph(dir: string, snapshot: GraphSnapshot): void {
  const arbiterDir = join(dir, '.arbiter')
  mkdirSync(arbiterDir, { recursive: true })
  writeFileSync(join(arbiterDir, 'graph.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')
}

/** Same INV id in both repos but with different `tier` attrs → risk-class-divergence. */
function writeInvWithTier(dir: string, invId: string, tier: string): void {
  const gateId = `GATE:${invId}-gate`
  const snap: GraphSnapshot = {
    nodes: [
      { id: invId, kind: 'INV', attrs: { title: `${invId} title`, tier } },
      { id: gateId, kind: 'GATE', attrs: { mechanism: 'shared-gate', title: 'shared-gate' } },
    ],
    edges: [{ from: invId, to: gateId, kind: 'enforces', attrs: {} }],
  }
  writeGraph(dir, snap)
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('runCompare — branch coverage', () => {
  // ── line 51: empty paths early-return guard ──────────────────────────────────
  it('returns error exit 2 when paths array is empty', () => {
    const result: CompareResult = runCompare({ paths: [] })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.reason).toContain('No repo paths provided')
  })

  // ── line 129: paths undefined → ?? [] fallback, no workspace ─────────────────
  it('returns error exit 2 when neither paths nor workspace are provided', () => {
    const result = runCompare({})
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
  })

  // ── line 68: relative path escaping cwd throws path-traversal error ──────────
  it('throws when a relative path escapes the working directory root', () => {
    // A relative path with a parent-dir segment resolves OUTSIDE cwd → must throw.
    const escaping = join('..', 'escape-outside-cwd')
    expect(() => runCompare({ paths: [escaping] })).toThrow(/escapes root/)
  })

  // ── lines 124/126: --workspace whose file cannot be parsed → empty paths ─────
  it('returns error exit 2 when workspace file is missing/unparseable', () => {
    const missing = join(tmpdir(), 'compare-cov-nonexistent-workspace.yaml')
    const result = runCompare({ workspace: missing })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
  })

  // ── lines 124/126 (ok branch) + 129 not taken: valid workspace yields repos ──
  it('loads repos from a valid --workspace spec', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    writeInvWithTier(repoA, 'INV-01', 'architectural')
    writeInvWithTier(repoB, 'INV-01', 'architectural')

    const wsDir = tmpRepo()
    const wsPath = join(wsDir, 'workspace.yaml')
    // Use absolute repo paths so the containment check (line 68) does not reject them.
    const yaml = `name: cov-org\nrepos:\n  - path: ${repoA}\n  - path: ${repoB}\n`
    writeFileSync(wsPath, yaml, 'utf-8')

    const result = runCompare({ workspace: wsPath })
    expect(result.status).toBe('ok')
    expect(result.reposLoaded).toBe(2)
  })

  // ── lines 145-150: failOn 'divergence' with a risk-class-divergence → exit 1 ─
  it('exits 1 with failOn=divergence when a risk-class-divergence finding exists', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    writeInvWithTier(repoA, 'INV-77', 'security')
    writeInvWithTier(repoB, 'INV-77', 'architectural')

    const result = runCompare({ paths: [repoA, repoB], failOn: 'divergence' })
    const divergences = result.findings.filter((f) => f.type === 'risk-class-divergence')
    expect(divergences.length).toBeGreaterThan(0)
    expect(result.exitCode).toBe(1)
  })

  // ── line 150 false path: failOn 'divergence' but no divergence findings → 0 ──
  it('exits 0 with failOn=divergence when there is no divergence finding', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    // Identical repos: same INV, same tier, same gate → no divergence at all.
    writeInvWithTier(repoA, 'INV-88', 'architectural')
    writeInvWithTier(repoB, 'INV-88', 'architectural')

    const result = runCompare({ paths: [repoA, repoB], failOn: 'divergence' })
    expect(result.findings.filter((f) => f.type === 'risk-class-divergence')).toHaveLength(0)
    expect(result.exitCode).toBe(0)
  })

  // ── lines 145-146: failOn 'any' with findings → exit 1 ──────────────────────
  it('exits 1 with failOn=any when any finding exists', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    writeInvWithTier(repoA, 'INV-99', 'security')
    writeInvWithTier(repoB, 'INV-99', 'operational')

    const result = runCompare({ paths: [repoA, repoB], failOn: 'any' })
    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.exitCode).toBe(1)
  })

  // ── line 145 false path: failOn 'any' but zero findings → exit 0 ────────────
  it('exits 0 with failOn=any when there are no findings', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    // Identical single INV/tier across both repos → all detectors quiet.
    writeInvWithTier(repoA, 'INV-11', 'architectural')
    writeInvWithTier(repoB, 'INV-11', 'architectural')

    const result = runCompare({ paths: [repoA, repoB], failOn: 'any' })
    expect(result.findings).toHaveLength(0)
    expect(result.exitCode).toBe(0)
  })

  // ── line 152 false path: failOn 'contradiction' but no contradiction → 0 ─────
  it('exits 0 with failOn=contradiction when no contradictory-adr finding exists', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    writeInvWithTier(repoA, 'INV-22', 'security')
    writeInvWithTier(repoB, 'INV-22', 'architectural')

    const result = runCompare({ paths: [repoA, repoB], failOn: 'contradiction' })
    expect(result.findings.filter((f) => f.type === 'contradictory-adr')).toHaveLength(0)
    expect(result.exitCode).toBe(0)
  })

  // ── line 139: topic filter matches ONLY a detail line (not invId/summary) ────
  it('keeps a finding when the topic matches only one of its detail lines', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    // Divergent tiers produce risk-class-divergence with detail "  ztieralpha: ...".
    writeInvWithTier(repoA, 'INV-33', 'ztieralpha')
    writeInvWithTier(repoB, 'INV-33', 'ztierbeta')

    const result = runCompare({ paths: [repoA, repoB], topic: 'ztieralpha' })
    const matched = result.findings.filter((f) =>
      (f.detail ?? []).some((d) => d.includes('ztieralpha')),
    )
    expect(matched.length).toBeGreaterThan(0)
    // The topic string appears in a detail line, not in invId/summary/repos.
    const f = matched[0]
    expect(f?.invId.toLowerCase().includes('ztieralpha')).toBe(false)
    expect(f?.summary.toLowerCase().includes('ztieralpha')).toBe(false)
  })

  // ── line 92 false branch: topic undefined → no filter applied ───────────────
  it('does not filter when no topic is given', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    writeInvWithTier(repoA, 'INV-44', 'security')
    writeInvWithTier(repoB, 'INV-44', 'architectural')

    const all = runCompare({ paths: [repoA, repoB] })
    const filtered = runCompare({ paths: [repoA, repoB], topic: 'security' })
    expect(filtered.findings.length).toBeLessThanOrEqual(all.findings.length)
  })

  // ── line 104: report write failure → warning pushed (err instanceof Error) ──
  it('records a warning when the report cannot be written (mkdir fails on a file path)', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    writeInvWithTier(repoA, 'INV-55', 'architectural')
    writeInvWithTier(repoB, 'INV-55', 'architectural')

    // Create a regular file, then ask to write the report UNDER it as if it were
    // a directory. mkdirSync(dirname) then throws ENOTDIR → caught → warning.
    const blockerDir = tmpRepo()
    const blockerFile = join(blockerDir, 'not-a-dir')
    writeFileSync(blockerFile, 'x', 'utf-8')
    const reportPath = join(blockerFile, 'sub', 'report.md')

    const result = runCompare({ paths: [repoA, repoB], format: reportPath })
    expect(result.status).toBe('ok')
    expect(result.reportPath).toBeUndefined()
    expect(result.warnings.some((w) => w.startsWith('Failed to write report:'))).toBe(true)
  })

  // ── line 96 true branch + success: report written, reportPath set ───────────
  it('writes the report and returns reportPath on success', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    writeInvWithTier(repoA, 'INV-66', 'security')
    writeInvWithTier(repoB, 'INV-66', 'architectural')

    const outDir = tmpRepo()
    const reportPath = join(outDir, 'nested', 'report.md')
    const result = runCompare({ paths: [repoA, repoB], format: reportPath })
    expect(result.reportPath).toBe(reportPath)
  })

  // ── line 78 true branch: warning collected when a repo has no graph ─────────
  it('collects a warning when a compared repo has no graph.json', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    writeInvWithTier(repoA, 'INV-01', 'architectural')
    // repoB intentionally has no .arbiter/graph.json
    const result = runCompare({ paths: [repoA, repoB] })
    expect(result.warnings.some((w) => w.includes('no graph'))).toBe(true)
  })

  // ── line 68: relative path that stays inside cwd is accepted ─────────────────
  it('accepts a relative path that resolves inside the working directory', () => {
    // A repo created under cwd, referenced relatively, must NOT throw.
    const insideDir = mkdtempSync(join(process.cwd(), 'compare-cov-inside-'))
    created.push(insideDir)
    writeInvWithTier(insideDir, 'INV-02', 'architectural')
    const rel = relative(process.cwd(), insideDir)

    const result = runCompare({ paths: [rel] })
    expect(result.status).toBe('ok')
    expect(result.reposLoaded).toBe(1)
  })
})
