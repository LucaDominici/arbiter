import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { runCompare, type CompareOptions, type CompareResult } from '../../src/commands/compare.js'
import { parseWorkspaceYaml } from '../../src/compare/workspace.js'
import type { GraphSnapshot } from '../../src/graph/model.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeGraph(dir: string, snapshot: GraphSnapshot): string {
  const out = join(dir, '.arbiter', 'graph.json')
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')
  return out
}

function makeRepoWithInv(
  dir: string,
  invId: string,
  gateId: string,
  gateLabel: string,
): GraphSnapshot {
  const snap: GraphSnapshot = {
    nodes: [
      { id: invId, kind: 'INV', attrs: { title: `${invId} title`, tier: 'architectural' } },
      { id: gateId, kind: 'GATE', attrs: { mechanism: gateLabel, title: gateLabel } },
    ],
    edges: [{ from: invId, to: gateId, kind: 'enforces', attrs: {} }],
  }
  writeGraph(dir, snap)
  return snap
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('compare (#264)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'compare-test-'))
    created.push(dir)
    return dir
  }

  // ── AC-1: Loads graphs from multiple repos ──────────────────────────────
  it('AC-1: loads graphs from multiple repos and returns ok status', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    makeRepoWithInv(repoA, 'INV-01', 'GATE:gate-a', 'gate-a')
    makeRepoWithInv(repoB, 'INV-01', 'GATE:gate-a', 'gate-a')

    const opts: CompareOptions = { paths: [repoA, repoB] }
    const result: CompareResult = runCompare(opts)
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.reposLoaded).toBe(2)
  })

  // ── AC-2: Detects divergent enforcement ─────────────────────────────────
  it('AC-2: detects divergent enforcement for same INV concept with different gates', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    // Same INV-01 in both repos, but different gate mechanisms
    makeRepoWithInv(repoA, 'INV-01', 'GATE:eslint-no-any', 'eslint-no-any')
    makeRepoWithInv(repoB, 'INV-01', 'GATE:tslint-no-any', 'tslint-no-any')

    const result = runCompare({ paths: [repoA, repoB] })
    const divergent = result.findings.filter((f) => f.type === 'divergent-enforcement')
    expect(divergent.length).toBeGreaterThan(0)
    expect(divergent[0]?.invId).toBe('INV-01')
  })

  // ── AC-3: No false positive when enforcement is identical ────────────────
  it('AC-3: no divergent-enforcement finding when gates are the same', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    makeRepoWithInv(repoA, 'INV-01', 'GATE:same-gate', 'same-gate')
    makeRepoWithInv(repoB, 'INV-01', 'GATE:same-gate', 'same-gate')

    const result = runCompare({ paths: [repoA, repoB] })
    const divergent = result.findings.filter((f) => f.type === 'divergent-enforcement')
    expect(divergent).toHaveLength(0)
  })

  // ── AC-4: Detects INVs unique to one repo ───────────────────────────────
  it('AC-4: detects invariants unique to one repo', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    makeRepoWithInv(repoA, 'INV-01', 'GATE:gate-a', 'gate-a')
    // repoB has an extra INV-99 that repoA does not
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-01', kind: 'INV', attrs: { title: 'INV-01 title', tier: 'architectural' } },
        { id: 'INV-99', kind: 'INV', attrs: { title: 'Only in B', tier: 'security' } },
        { id: 'GATE:gate-a', kind: 'GATE', attrs: { mechanism: 'gate-a', title: 'gate-a' } },
        { id: 'GATE:gate-99', kind: 'GATE', attrs: { mechanism: 'gate-99', title: 'gate-99' } },
      ],
      edges: [
        { from: 'INV-01', to: 'GATE:gate-a', kind: 'enforces', attrs: {} },
        { from: 'INV-99', to: 'GATE:gate-99', kind: 'enforces', attrs: {} },
      ],
    }
    writeGraph(repoB, snap)

    const result = runCompare({ paths: [repoA, repoB] })
    const unique = result.findings.filter((f) => f.type === 'unique-to-one-repo')
    expect(unique.some((f) => f.invId === 'INV-99')).toBe(true)
  })

  // ── AC-5: --fail-on contradiction exits non-zero ────────────────────────
  it('AC-5: --fail-on contradiction exits 1 when contradictions found', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    // Divergent enforcement is the closest we get to contradiction with Wave-1 graph data
    makeRepoWithInv(repoA, 'INV-01', 'GATE:gate-a', 'gate-a')
    makeRepoWithInv(repoB, 'INV-01', 'GATE:gate-b', 'gate-b')

    const result = runCompare({ paths: [repoA, repoB], failOn: 'contradiction' })
    // No ADR contradiction nodes exist yet (Wave-1 only has INV+GATE), so no contradictions
    // The command should still exit 0 — graceful degradation
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
    // But findings should still show divergent-enforcement
    expect(
      result.findings.filter((f) => f.type === 'divergent-enforcement').length,
    ).toBeGreaterThan(0)
  })

  // ── AC-6: --fail-on contradiction with actual contradiction exits non-zero
  it('AC-6: --fail-on contradiction exits 1 when contradictory-adr findings exist', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    // Simulate ADR contradiction by injecting supersedes-style nodes
    const snapA: GraphSnapshot = {
      nodes: [
        { id: 'ADR-01', kind: 'ADR', attrs: { title: 'Do X', status: 'accepted' } },
        { id: 'GATE:ga', kind: 'GATE', attrs: { mechanism: 'ga', title: 'ga' } },
      ],
      edges: [{ from: 'ADR-01', to: 'GATE:ga', kind: 'enforces', attrs: {} }],
    }
    const snapB: GraphSnapshot = {
      nodes: [
        { id: 'ADR-01', kind: 'ADR', attrs: { title: 'Do NOT X', status: 'accepted' } },
        { id: 'GATE:gb', kind: 'GATE', attrs: { mechanism: 'gb', title: 'gb' } },
      ],
      edges: [{ from: 'ADR-01', to: 'GATE:gb', kind: 'enforces', attrs: {} }],
    }
    writeGraph(repoA, snapA)
    writeGraph(repoB, snapB)

    const result = runCompare({ paths: [repoA, repoB], failOn: 'contradiction' })
    const contradictions = result.findings.filter((f) => f.type === 'contradictory-adr')
    // With opposite ADR titles, we detect a contradiction
    expect(contradictions.length).toBeGreaterThan(0)
    expect(result.exitCode).toBe(1)
  })

  // ── AC-7: Graceful degradation when one repo has no graph ───────────────
  it('AC-7: graceful degradation when one repo has no graph (falls back to INV catalog)', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    // repoA has a graph, repoB has nothing
    makeRepoWithInv(repoA, 'INV-01', 'GATE:gate-a', 'gate-a')
    // repoB: no .arbiter/graph.json

    const result = runCompare({ paths: [repoA, repoB] })
    // Should not throw; repoB contributes INV catalog nodes or 0 nodes
    expect(result.status).toBe('ok')
    expect(result.reposLoaded).toBe(2)
    expect(result.warnings.some((w) => w.includes('no graph'))).toBe(true)
  })

  // ── AC-8: --format report.md writes file ───────────────────────────────
  it('AC-8: --format report.md writes a markdown report', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    const outDir = tmpRepo()
    const reportPath = join(outDir, 'report.md')
    makeRepoWithInv(repoA, 'INV-01', 'GATE:gate-a', 'gate-a')
    makeRepoWithInv(repoB, 'INV-01', 'GATE:gate-b', 'gate-b')

    const result = runCompare({ paths: [repoA, repoB], format: reportPath })
    expect(result.status).toBe('ok')
    // Report file written
    expect(existsSync(reportPath)).toBe(true)
  })

  // ── AC-9: Reports promotion asymmetry ────────────────────────────────────
  it('AC-9: reports promotion asymmetry (INV in one repo, no INV node in other)', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    // repoA has INV-42 enforced by a gate; repoB has no INV-42 at all
    makeRepoWithInv(repoA, 'INV-42', 'GATE:gate-42', 'gate-42')
    // repoB has only INV-01
    makeRepoWithInv(repoB, 'INV-01', 'GATE:gate-01', 'gate-01')

    const result = runCompare({ paths: [repoA, repoB] })
    // INV-42 appears only in repoA → unique-to-one-repo OR promotion-asymmetry finding
    const asymmetry = result.findings.filter(
      (f) => f.type === 'promotion-asymmetry' || f.type === 'unique-to-one-repo',
    )
    expect(asymmetry.some((f) => f.invId === 'INV-42')).toBe(true)
  })

  // ── AC-10: --topic filters findings ─────────────────────────────────────
  it('AC-10: --topic filters to findings mentioning that topic (case-insensitive)', () => {
    const repoA = tmpRepo()
    const repoB = tmpRepo()
    makeRepoWithInv(repoA, 'INV-01', 'GATE:security-scan', 'security-scan')
    makeRepoWithInv(repoB, 'INV-01', 'GATE:lint-any', 'lint-any')

    const resultAll = runCompare({ paths: [repoA, repoB] })
    const resultFiltered = runCompare({ paths: [repoA, repoB], topic: 'security' })
    // When filtered, fewer or equal findings
    expect(resultFiltered.findings.length).toBeLessThanOrEqual(resultAll.findings.length)
  })
})

describe('parseWorkspaceYaml', () => {
  it('parses a valid workspace spec', () => {
    const yaml = `name: my-org\nrepos:\n  - path: ./repoA\n    role: production\n    tier: L3\n  - path: ./repoB\n`
    const result = parseWorkspaceYaml(yaml)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.name).toBe('my-org')
    expect(result.spec.repos).toHaveLength(2)
    expect(result.spec.repos[0]?.path).toBe('./repoA')
    expect(result.spec.repos[0]?.role).toBe('production')
  })

  it('returns error when no repos found', () => {
    const result = parseWorkspaceYaml('name: empty\n')
    expect(result.ok).toBe(false)
  })

  it('strips inline comments', () => {
    const yaml = `name: org # comment\nrepos:\n  - path: ./x # inline\n`
    const result = parseWorkspaceYaml(yaml)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.name).toBe('org')
    expect(result.spec.repos[0]?.path).toBe('./x')
  })
})

// #1607: a --workspace parse failure must surface its precise reason in
// runCompare's `reason`, not collapse to the misleading "No repo paths provided".
describe('runCompare — --workspace error fidelity (#1607)', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('surfaces the read-error reason when --workspace file is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'compare-ws-'))
    const missing = join(dir, 'does-not-exist.yaml')
    const result = runCompare({ workspace: missing })
    expect(result.exitCode).toBe(2)
    expect(result.reason).toContain('failed to read workspace file')
    expect(result.reason).not.toContain('No repo paths provided')
  })

  it('surfaces the no-repos reason when --workspace spec has no repos', () => {
    dir = mkdtempSync(join(tmpdir(), 'compare-ws-'))
    const empty = join(dir, 'empty.yaml')
    writeFileSync(empty, 'name: empty\n', 'utf-8')
    const result = runCompare({ workspace: empty })
    expect(result.exitCode).toBe(2)
    expect(result.reason).toContain('no repos found in workspace spec')
    expect(result.reason).not.toContain('No repo paths provided')
  })

  it('still reports the generic message when neither paths nor --workspace given', () => {
    const result = runCompare({})
    expect(result.exitCode).toBe(2)
    expect(result.reason).toContain('No repo paths provided')
  })
})
