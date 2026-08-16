// SPDX-License-Identifier: Apache-2.0
// #2039: `arbiter method` — the feature lens over configure's field surface.
//
// The load-bearing assertions here are the ones that stop the probe from LYING:
// a catalog row bound to a path `configure` would reject, a feature reported "wired"
// because its flag is merely defined rather than on, and an Emit facet that claims
// satisfaction for a file that is in the manifest but no longer on disk.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CLUSTERS,
  METHODOLOGY_CATALOG,
  NON_METHODOLOGY_PATHS,
  probeAll,
  probeFeature,
  runMethodStatus,
  type MethodologyFeature,
} from '../../src/commands/method.js'
import { ALLOWED_PATHS } from '../../src/commands/configure.js'

// Derived here rather than exported from method.ts: a convenience set with exactly one
// consumer is not public API, and this repo ratchets on the count of them.
const METHODOLOGY_PATHS: ReadonlySet<string> = new Set(
  METHODOLOGY_CATALOG.flatMap((f) => f.configPaths),
)

let dir: string
afterEach(() => {
  vi.restoreAllMocks()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const BASE = {
  version: '0.2',
  governanceLevel: 'L2',
  tools: ['claude'],
  permitGitHub: false,
  features: {
    contractTesting: false,
    mutationTesting: false,
    securityScanning: true,
    evidenceHarness: false,
    debtGates: true,
    suppressions: true,
  },
  thresholds: {
    lineCoverage: 80,
    branchCoverage: 75,
    mutationScore: 60,
    cyclomaticComplexity: 15,
    methodLength: 65,
    maxParams: 5,
  },
}

function projectWith(overrides: Record<string, unknown> = {}): string {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-method-'))
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ ...BASE, ...overrides }))
  return dir
}

/** Record a file in the generated manifest, optionally without putting it on disk. */
function manifested(root: string, key: string, opts: { onDisk: boolean }): void {
  writeFileSync(
    join(root, '.arbiter-generated-manifest.json'),
    JSON.stringify({ $schemaVersion: 1, files: { [key]: 'deadbeef' } }),
  )
  if (opts.onDisk) {
    mkdirSync(join(root, key, '..'), { recursive: true })
    writeFileSync(join(root, key), 'x')
  }
}

describe('METHODOLOGY_CATALOG — the parity contract, asserted in-process too', () => {
  // scripts/check-methodology-coverage.mjs is the build gate; this is the same rule
  // asserted against the real objects rather than a regex over the source, so a parser
  // that silently stops matching cannot make BOTH go quiet at once.
  it('binds only paths configure would accept', () => {
    for (const path of METHODOLOGY_PATHS) expect(ALLOWED_PATHS.has(path)).toBe(true)
  })

  it('leaves no settable path unlensed and unexcluded', () => {
    const unaccounted = [...ALLOWED_PATHS].filter(
      (p) => !METHODOLOGY_PATHS.has(p) && !NON_METHODOLOGY_PATHS.has(p),
    )
    expect(unaccounted).toEqual([])
  })

  it('excludes nothing that is not settable — a stale exclusion pre-approves an omission', () => {
    for (const p of NON_METHODOLOGY_PATHS.keys()) expect(ALLOWED_PATHS.has(p)).toBe(true)
  })

  it('gives every path exactly one owning row', () => {
    const all = METHODOLOGY_CATALOG.flatMap((f) => f.configPaths)
    expect(all.length).toBe(new Set(all).size)
  })

  it('has unique ids and only known clusters', () => {
    const ids = METHODOLOGY_CATALOG.map((f) => f.id)
    expect(ids.length).toBe(new Set(ids).size)
    for (const f of METHODOLOGY_CATALOG) expect(CLUSTERS).toContain(f.cluster)
  })
})

describe('probe — Config facet', () => {
  it('reads a false flag as OFF, not as "configured"', () => {
    const root = projectWith()
    const statuses = probeAll(root, BASE)
    const contract = statuses.find((s) => s.id === 'M-TEST-01')
    expect(contract?.config).toBe('inactive')
    expect(contract?.verdict).toBe('off')
  })

  it('needs EVERY bound path active — half a binding is not "on"', () => {
    const feature: MethodologyFeature = {
      id: 'X',
      cluster: 'testing',
      name: 'two-path',
      configPaths: ['features.mutationTesting', 'thresholds.mutationScore'],
    }
    const onlyFlag = { features: { mutationTesting: true }, thresholds: {} }
    expect(probeFeature(feature, onlyFlag, {}, '/nowhere').config).toBe('inactive')

    const both = { features: { mutationTesting: true }, thresholds: { mutationScore: 60 } }
    expect(probeFeature(feature, both, {}, '/nowhere').config).toBe('active')
  })

  it('treats an empty array as inactive (tools: [] is not a configured harness)', () => {
    const feature: MethodologyFeature = {
      id: 'X',
      cluster: 'agentic-harness',
      name: 'tools',
      configPaths: ['tools'],
    }
    expect(probeFeature(feature, { tools: [] }, {}, '/nowhere').config).toBe('inactive')
    expect(probeFeature(feature, { tools: ['claude'] }, {}, '/nowhere').config).toBe('active')
  })
})

describe('probe — Emit facet', () => {
  const feature: MethodologyFeature = {
    id: 'X',
    cluster: 'gates-cli',
    name: 'emits something',
    configPaths: ['features.debtGates'],
    emits: ['scripts/gate.mjs'],
  }
  const on = { features: { debtGates: true } }

  it('is n/a — never a fake green — for a row that declares no artifact', () => {
    const noEmits: MethodologyFeature = { ...feature, emits: undefined }
    const s = probeFeature(noEmits, on, {}, '/nowhere')
    expect(s.emit).toBe('n/a')
    expect(s.verdict).toBe('wired')
  })

  // THE issue's own test case: on in config, gate file not emitted -> partial.
  it('is missing when the artifact was never recorded — Config OK / Emit missing = partial', () => {
    const root = projectWith({ features: { ...BASE.features, debtGates: true } })
    const s = probeFeature(feature, on, {}, root)
    expect(s.emit).toBe('missing')
    expect(s.verdict).toBe('partial')
    expect(s.missingEmits).toEqual(['scripts/gate.mjs'])
  })

  it('is missing when the manifest records it but the file is GONE from disk', () => {
    const root = projectWith()
    manifested(root, 'scripts/gate.mjs', { onDisk: false })
    const s = probeFeature(feature, on, { 'scripts/gate.mjs': 'deadbeef' }, root)
    expect(s.emit).toBe('missing')
  })

  it('is satisfied only when the manifest AND the disk agree', () => {
    const root = projectWith()
    manifested(root, 'scripts/gate.mjs', { onDisk: true })
    const s = probeFeature(feature, on, { 'scripts/gate.mjs': 'deadbeef' }, root)
    expect(s.emit).toBe('satisfied')
    expect(s.verdict).toBe('wired')
  })

  // The manifest-absent case. Reporting "not emitted" for a repo that has never run
  // `arbiter update` (or for arbiter's own tree, which generates rather than consumes) would
  // paint every bound row broken on a healthy project.
  it('is unknown, NOT missing, when the project has no manifest at all', () => {
    const root = projectWith()
    const s = probeFeature(feature, on, {}, root, false)
    expect(s.emit).toBe('unknown')
    expect(s.verdict).toBe('unverified')
    expect(s.missingEmits).toEqual([])
  })

  it('an off feature stays off regardless of what is on disk', () => {
    const root = projectWith()
    manifested(root, 'scripts/gate.mjs', { onDisk: true })
    const s = probeFeature(feature, { features: { debtGates: false } }, {}, root)
    expect(s.verdict).toBe('off')
  })
})

// registry.ts gates contractTesting/mutationTesting/evidenceHarness with `!== false`, so an
// arbiter.json that never mentions them is a project where they RUN. The intuitive rule —
// absent means off — would report three live features as disabled on a default config.
describe('probe — default-ON semantics', () => {
  const paths = ['features.contractTesting', 'features.mutationTesting', 'features.evidenceHarness']

  it('treats an absent default-ON flag as active', () => {
    for (const path of paths) {
      const f: MethodologyFeature = { id: 'X', cluster: 'testing', name: path, configPaths: [path] }
      expect(probeFeature(f, { features: {} }, {}, '/nowhere').config, path).toBe('active')
    }
  })

  it('still respects an EXPLICIT false on a default-ON flag', () => {
    for (const path of paths) {
      const f: MethodologyFeature = { id: 'X', cluster: 'testing', name: path, configPaths: [path] }
      const key = path.split('.')[1] as string
      expect(probeFeature(f, { features: { [key]: false } }, {}, '/nowhere').config, path).toBe(
        'inactive',
      )
    }
  })

  it('does NOT extend default-ON to an ordinary opt-in flag', () => {
    const f: MethodologyFeature = {
      id: 'X',
      cluster: 'testing',
      name: 'perf',
      configPaths: ['features.perfTesting'],
    }
    expect(probeFeature(f, { features: {} }, {}, '/nowhere').config).toBe('inactive')
  })
})

describe('runMethodStatus', () => {
  it('writes nothing — status is a pure read', () => {
    const root = projectWith()
    const before = JSON.stringify(readdirSync(root).sort())
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    runMethodStatus({ dir: root })
    expect(JSON.stringify(readdirSync(root).sort())).toBe(before)
  })

  it('emits machine-readable JSON with --json, clustered and summarised', () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    runMethodStatus({ dir: projectWith(), json: true })
    const parsed = JSON.parse(out.join('')) as {
      data: {
        clusters: Array<{ cluster: string; features: Array<{ id: string; verdict: string }> }>
        summary: { wired: number; partial: number; unverified: number; off: number }
      }
    }
    expect(parsed.data.clusters.map((c) => c.cluster)).toEqual([...CLUSTERS])
    const total = parsed.data.clusters.reduce((n, c) => n + c.features.length, 0)
    expect(total).toBe(METHODOLOGY_CATALOG.length)
    const { wired, partial, unverified, off } = parsed.data.summary
    expect(wired + partial + unverified + off).toBe(METHODOLOGY_CATALOG.length)
  })

  // The partial path end to end: manifest present, a bound feature ON, its artifacts not
  // recorded. This is the row the issue's own test case describes (Config OK / Emit missing),
  // and it is the only path that renders the per-artifact "not emitted" lines.
  it('renders the missing artifacts of a partial feature', () => {
    const root = projectWith({ features: { ...BASE.features, debtGates: true } })
    writeFileSync(
      join(root, '.arbiter-generated-manifest.json'),
      JSON.stringify({ $schemaVersion: 1, files: { 'README.md': 'deadbeef' } }),
    )
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    runMethodStatus({ dir: root })
    const text = out.join('')
    expect(text).toContain('not emitted: scripts/debt-lib.mjs')
    expect(text).toContain('Emit ✗')
    // debtGates and suppressions are both ON in BASE and both carry Emit bindings.
    expect(text).toContain('not emitted: scripts/check-suppressions.mjs')
    expect(text).toMatch(/partial 2/)
    // and with a manifest present nothing is "unverified" any more
    expect(text).toMatch(/unverified 0/)
  })

  it('exits nonzero when there is no arbiter.json', () => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-method-empty-'))
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((c?: number | string | null) => {
      throw new Error(`exit:${String(c)}`)
    })
    expect(() => runMethodStatus({ dir })).toThrow('exit:1')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
