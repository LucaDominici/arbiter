// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/commands/graph.ts (#1486).
 *
 * Targets the uncovered branches the primary suite leaves open:
 *   - runGraphBuild write-error catch (mkdirSync/writeFileSync throws)
 *   - loadSnapshot read-error catch (input path is a directory)
 *   - loadSnapshot non-object JSON guard
 *   - loadSnapshot missing nodes/edges arrays guard
 *   - checkBrokenRefs 'from' endpoint missing (suite only hits 'to')
 *   - checkStaleProvers: TEST with non-string path (continue), TEST whose
 *     path DOES exist on disk (the !exists=false branch), TEST node absent
 *   - checkMissingEvidence: enforced GATE that DOES produce evidence
 *     (the loop iterates without breaking) plus a clean no-failure pass
 *
 * Test-only: uses real temp fixtures cleaned in afterEach. No network, no git,
 * no gh, no process.exit. Deterministic.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { runGraphBuild, runVerifyGraph } from '../../src/commands/graph.js'
import type { GraphFailure } from '../../src/commands/graph.js'
import type { GraphSnapshot } from '../../src/graph/model.js'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

function writeSnapshotRaw(dir: string, contents: string): string {
  const out = join(dir, '.arbiter', 'graph.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, contents, 'utf-8')
  return out
}

function writeSnapshot(dir: string, snapshot: GraphSnapshot): string {
  return writeSnapshotRaw(dir, JSON.stringify(snapshot, null, 2) + '\n')
}

describe('runGraphBuild — write-error branch (line 84)', () => {
  it('returns error when the output parent path component is a file (ENOTDIR)', () => {
    const dir = tmp('graph-build-fail-')
    // Create a regular file, then aim the output at a path *underneath* it so
    // mkdirSync(dirname(outPath)) throws ENOTDIR — exercising the catch block.
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory', 'utf-8')
    const output = join(blocker, 'nested', 'graph.json')

    const result = runGraphBuild({ dir, output })

    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.path).toBe(output)
    // Reason carries the Error.message branch of the ternary.
    expect(result.reason).toMatch(/failed to write/)
    // nodes/edges are still reported from the in-memory snapshot.
    expect(result.nodes).toBeGreaterThan(0)
    expect(result.edges).toBeGreaterThan(0)
  })
})

describe('runVerifyGraph — loadSnapshot guard branches', () => {
  it('read-error: input path is a directory, not a file (line 213 catch)', () => {
    const dir = tmp('graph-read-err-')
    // Point input at a directory. existsSync passes; readFileSync throws EISDIR.
    const inputDir = join(dir, 'a-directory')
    mkdirSync(inputDir, { recursive: true })

    const result = runVerifyGraph({ dir, input: inputDir })

    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.reason).toMatch(/failed to read/)
    expect(result.orphans).toEqual([])
    expect(result.failures).toEqual([])
    expect(result.totalInv).toBe(0)
  })

  it('non-object JSON: a bare number is rejected (line 226)', () => {
    const dir = tmp('graph-nonobj-')
    writeSnapshotRaw(dir, '42')

    const result = runVerifyGraph({ dir })

    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/expected JSON object/)
  })

  it('null JSON is rejected by the same non-object guard', () => {
    const dir = tmp('graph-null-')
    writeSnapshotRaw(dir, 'null')

    const result = runVerifyGraph({ dir })

    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/expected JSON object/)
  })

  it('object missing nodes/edges arrays is rejected (line 230)', () => {
    const dir = tmp('graph-noarrays-')
    writeSnapshotRaw(dir, JSON.stringify({ foo: 'bar' }))

    const result = runVerifyGraph({ dir })

    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/missing nodes\/edges arrays/)
  })

  it('object with nodes array but edges NOT an array is rejected (right side of ||)', () => {
    const dir = tmp('graph-edges-notarr-')
    writeSnapshotRaw(dir, JSON.stringify({ nodes: [], edges: 'oops' }))

    const result = runVerifyGraph({ dir })

    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/missing nodes\/edges arrays/)
  })
})

describe('checkBrokenRefs — from-endpoint missing (line 252)', () => {
  it("flags an edge whose 'from' node does not exist", () => {
    const dir = tmp('graph-broken-from-')
    // 'to' exists, 'from' does not — exercises the first of the two if guards.
    const snap = {
      nodes: [{ id: 'INV-01', kind: 'INV', attrs: {} }],
      edges: [{ from: 'GHOST:missing', to: 'INV-01', kind: 'enforces', attrs: {} }],
    }
    writeSnapshotRaw(dir, JSON.stringify(snap, null, 2) + '\n')

    const result = runVerifyGraph({ dir })

    const broken = result.failures.filter((f: GraphFailure) => f.kind === 'broken-ref')
    expect(broken.length).toBeGreaterThan(0)
    expect(broken.some((f: GraphFailure) => f.reason.includes("'from' node"))).toBe(true)
    expect(broken[0]?.reason).toContain('GHOST:missing')
  })

  it("flags both endpoints when 'from' AND 'to' are missing", () => {
    const dir = tmp('graph-broken-both-')
    const snap = {
      nodes: [{ id: 'INV-01', kind: 'INV', attrs: {} }],
      edges: [{ from: 'GHOST:from', to: 'GHOST:to', kind: 'enforces', attrs: {} }],
    }
    writeSnapshotRaw(dir, JSON.stringify(snap, null, 2) + '\n')

    const result = runVerifyGraph({ dir })

    const broken = result.failures.filter((f: GraphFailure) => f.kind === 'broken-ref')
    // Both the 'from' and 'to' guards fire for the single malformed edge.
    expect(broken.length).toBe(2)
  })
})

describe('checkStaleProvers — non-string path and existing path branches', () => {
  it('skips a TEST node whose path attr is not a string (continue branch)', () => {
    const dir = tmp('graph-test-nonstr-')
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-01', kind: 'INV', attrs: {} },
        { id: 'GATE:foo', kind: 'GATE', attrs: {} },
        // path is a number → typeof !== 'string' → continue, never flagged stale
        { id: 'TEST:weird', kind: 'TEST', attrs: { path: 123 } },
      ],
      edges: [
        { from: 'INV-01', to: 'GATE:foo', kind: 'enforces', attrs: {} },
        { from: 'TEST:weird', to: 'INV-01', kind: 'proves', attrs: {} },
      ],
    }
    writeSnapshot(dir, snap)

    const result = runVerifyGraph({ dir })

    const stale = result.failures.filter((f: GraphFailure) => f.kind === 'stale-prover')
    expect(stale).toHaveLength(0)
  })

  it('does NOT flag a TEST node whose path DOES exist on disk (exists=true branch)', () => {
    const dir = tmp('graph-test-real-')
    // Create a real file relative to dir, then reference it from the TEST node.
    const relPath = join('sub', 'real.test.ts')
    const absPath = join(dir, relPath)
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, '// real test file', 'utf-8')

    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-01', kind: 'INV', attrs: {} },
        { id: 'GATE:foo', kind: 'GATE', attrs: {} },
        { id: 'TEST:real', kind: 'TEST', attrs: { path: relPath } },
      ],
      edges: [
        { from: 'INV-01', to: 'GATE:foo', kind: 'enforces', attrs: {} },
        { from: 'TEST:real', to: 'INV-01', kind: 'proves', attrs: {} },
      ],
    }
    writeSnapshot(dir, snap)

    const result = runVerifyGraph({ dir })

    const stale = result.failures.filter((f: GraphFailure) => f.kind === 'stale-prover')
    expect(stale).toHaveLength(0)
  })
})

describe('checkMissingEvidence — enforced GATE that produces evidence (loop no-break)', () => {
  it('does not flag and iterates a second enforces edge when the first GATE has evidence', () => {
    const dir = tmp('graph-evid-ok-')
    // INV-01 enforces TWO gates; both produce evidence. The inner loop must
    // iterate both enforces edges without ever taking the break — covering the
    // false side of the `!gatesWithEvidence.has(edge.to)` branch.
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-01', kind: 'INV', attrs: {} },
        { id: 'GATE:foo', kind: 'GATE', attrs: {} },
        { id: 'GATE:bar', kind: 'GATE', attrs: {} },
        { id: 'EVIDENCE:e1', kind: 'EVIDENCE', attrs: {} },
        { id: 'EVIDENCE:e2', kind: 'EVIDENCE', attrs: {} },
      ],
      edges: [
        { from: 'INV-01', to: 'GATE:foo', kind: 'enforces', attrs: {} },
        { from: 'INV-01', to: 'GATE:bar', kind: 'enforces', attrs: {} },
        { from: 'GATE:foo', to: 'EVIDENCE:e1', kind: 'produces', attrs: {} },
        { from: 'GATE:bar', to: 'EVIDENCE:e2', kind: 'produces', attrs: {} },
      ],
    }
    writeSnapshot(dir, snap)

    const result = runVerifyGraph({ dir })

    const missing = result.failures.filter((f: GraphFailure) => f.kind === 'missing-evidence')
    expect(missing).toHaveLength(0)
    // The whole graph is clean here (every INV enforces an evidenced gate).
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
  })
})

describe('runGraphBuild — output override resolution branch', () => {
  it('honours an explicit output path (opts.output !== undefined branch)', () => {
    const dir = tmp('graph-out-override-')
    const output = join(dir, 'custom', 'out.json')

    const result = runGraphBuild({ dir, output })

    expect(result.status).toBe('ok')
    expect(result.path).toBe(output)
  })

  it(
    'uses default dir when opts.dir is omitted but writes via output override',
    () => {
      // Covers the `opts.dir ?? '.'` nullish branch without touching cwd files:
      // we force the write target via output so the default dir is never written.
      const dir = tmp('graph-default-dir-')
      const output = join(dir, 'forced.json')

      const result = runGraphBuild({ output })

      expect(result.status).toBe('ok')
      expect(result.path).toBe(output)
    },
    // Omitting dir means the graph is built over the whole repo root (that is
    // the branch under test) — ~32s alone on a warm dev box, brushing the
    // global 30s testTimeout and red-ing gates on loaded machines (#1806 drive).
    120000,
  )
})
