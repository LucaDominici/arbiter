// SPDX-License-Identifier: Apache-2.0
// Coverage test for src/conformance/dimensions.ts (#1483).
//
// Exercises every exported probe function across its verdict ladder:
// missing-manifest, parse-error, empty/absent, each conditional branch,
// and the happy path. Filesystem reads are backed by real temp fixture dirs
// (mkdtempSync under the OS tmpdir) and torn down in afterEach. Pure, fast,
// deterministic — no Date.now() assertions, no network.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  probeDTestLevels,
  probeDLiveE2e,
  probeDFeRenderGate,
  probeDDomainApi,
  probeDDoneEvidence,
  probeGateGreen,
  probeCoverageThresholds,
  probeInvariantsEnforced,
  probeNoOverclaim,
  probeCommitHygiene,
  probeFindingHygiene,
} from '../../src/conformance/dimensions.js'

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dimensions-cov-'))
  created.push(dir)
  return dir
}

/** Write a file relative to root, creating parent dirs as needed. */
function writeAt(root: string, rel: string, content: string): void {
  const abs = join(root, rel)
  const parent = abs.slice(0, abs.lastIndexOf('/'))
  if (parent.length > 0) mkdirSync(parent, { recursive: true })
  writeFileSync(abs, content, 'utf-8')
}

function writeJson(root: string, rel: string, value: unknown): void {
  writeAt(root, rel, JSON.stringify(value))
}

// ── probeDTestLevels ──────────────────────────────────────────────────────────

describe('probeDTestLevels', () => {
  it('N when test-pyramid.json is missing', () => {
    const entry = probeDTestLevels(tmpRoot())
    expect(entry.id).toBe('D-TEST-LEVELS')
    expect(entry.family).toBe('reality-contact')
    expect(entry.tier).toBe(1)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('missing')
  })

  it('N on parse error (invalid JSON)', () => {
    const root = tmpRoot()
    writeAt(root, 'test-pyramid.json', '{ this is not json')
    const entry = probeDTestLevels(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toBe('parse error')
  })

  it('N when manifest is a non-object (e.g. array)', () => {
    const root = tmpRoot()
    writeJson(root, 'test-pyramid.json', [1, 2, 3])
    const entry = probeDTestLevels(root)
    // Arrays parse to objects in JS so this hits the "no levels declared" branch.
    expect(entry.verdict).toBe('N')
  })

  it('N when levels array is empty', () => {
    const root = tmpRoot()
    writeJson(root, 'test-pyramid.json', { levels: [] })
    const entry = probeDTestLevels(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toBe('no levels declared')
  })

  it('N when a required level has no matching test file', () => {
    const root = tmpRoot()
    writeJson(root, 'test-pyramid.json', {
      levels: [{ level: 'unit', status: 'required', globs: ['__tests__/**/*.test.ts'] }],
    })
    const entry = probeDTestLevels(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('empty required levels')
    expect((entry.evidence as { detail: string }).detail).toContain('unit')
  })

  it('Y when all required levels are populated', () => {
    const root = tmpRoot()
    writeAt(root, '__tests__/a.test.ts', 'export const a = 1')
    writeJson(root, 'test-pyramid.json', {
      levels: [{ level: 'unit', status: 'required', globs: ['__tests__/**/*.test.ts'] }],
    })
    const entry = probeDTestLevels(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toContain('all required levels')
  })

  it('Y when a non-required level is empty (status != required is skipped)', () => {
    const root = tmpRoot()
    writeJson(root, 'test-pyramid.json', {
      levels: [{ level: 'e2e', status: 'optional', globs: ['e2e/**/*.spec.ts'] }],
    })
    const entry = probeDTestLevels(root)
    expect(entry.verdict).toBe('Y')
  })

  it('Y when a level entry is not an object (skipped by checkRequiredLevel)', () => {
    const root = tmpRoot()
    writeJson(root, 'test-pyramid.json', { levels: ['not-an-object', null] })
    const entry = probeDTestLevels(root)
    expect(entry.verdict).toBe('Y')
  })

  it('defaults status to required and level name to unknown when omitted', () => {
    const root = tmpRoot()
    // No status field → treated as required; no level name → "unknown"; no globs → no match → N.
    writeJson(root, 'test-pyramid.json', { levels: [{ globs: ['nope/**/*.ts'] }] })
    const entry = probeDTestLevels(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('unknown')
  })
})

// ── probeDLiveE2e ───────────────────────────────────────────────────────────────

describe('probeDLiveE2e', () => {
  it('NA for a null archetype (not a service type)', () => {
    const entry = probeDLiveE2e(tmpRoot(), null)
    expect(entry.id).toBe('D-LIVE-E2E')
    expect(entry.verdict).toBe('NA')
    expect((entry.evidence as { detail: string }).detail).toContain('unset')
  })

  it('NA for a non-service archetype (frontend)', () => {
    const entry = probeDLiveE2e(tmpRoot(), 'frontend')
    expect(entry.verdict).toBe('NA')
    expect((entry.evidence as { detail: string }).detail).toContain('frontend')
  })

  it('N when service archetype but api-e2e.json missing', () => {
    const entry = probeDLiveE2e(tmpRoot(), 'backend')
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('missing')
  })

  it('N on parse error for a service archetype', () => {
    const root = tmpRoot()
    writeAt(root, 'api-e2e.json', 'not json{')
    const entry = probeDLiveE2e(root, 'service')
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toBe('parse error')
  })

  it('N when suiteCount is 0', () => {
    const root = tmpRoot()
    writeJson(root, 'api-e2e.json', { suiteCount: 0 })
    const entry = probeDLiveE2e(root, 'backend-api')
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('no e2e suites')
  })

  it('Y when suiteCount > 0', () => {
    const root = tmpRoot()
    writeJson(root, 'api-e2e.json', { suiteCount: 3 })
    const entry = probeDLiveE2e(root, 'fullstack')
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toBe('suiteCount=3')
  })

  it('treats a "backend-*" prefixed archetype as a service type', () => {
    const root = tmpRoot()
    writeJson(root, 'api-e2e.json', { suiteCount: 1 })
    const entry = probeDLiveE2e(root, 'backend-custom-thing')
    expect(entry.verdict).toBe('Y')
  })
})

// ── probeDFeRenderGate ──────────────────────────────────────────────────────────

describe('probeDFeRenderGate', () => {
  it('NA for a null archetype', () => {
    const entry = probeDFeRenderGate(tmpRoot(), null)
    expect(entry.id).toBe('D-FE-RENDER-GATE')
    expect(entry.verdict).toBe('NA')
    expect((entry.evidence as { detail: string }).detail).toContain('unset')
  })

  it('NA for a non-frontend archetype (backend)', () => {
    const entry = probeDFeRenderGate(tmpRoot(), 'backend')
    expect(entry.verdict).toBe('NA')
  })

  it('N when frontend archetype has no render config', () => {
    const entry = probeDFeRenderGate(tmpRoot(), 'frontend')
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('no playwright')
  })

  it('Y when a playwright config is present', () => {
    const root = tmpRoot()
    writeAt(root, 'playwright.config.ts', 'export default {}')
    const entry = probeDFeRenderGate(root, 'frontend-web')
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { file: string }).file).toBe('playwright.config.ts')
  })

  it('Y when a vitest browser config is present (later in the list)', () => {
    const root = tmpRoot()
    writeAt(root, 'vitest.browser.config.js', 'module.exports = {}')
    const entry = probeDFeRenderGate(root, 'fullstack')
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { file: string }).file).toBe('vitest.browser.config.js')
  })

  it('treats a "frontend-*" prefixed archetype as frontend', () => {
    const root = tmpRoot()
    writeAt(root, 'chromatic.config.ts', 'export default {}')
    const entry = probeDFeRenderGate(root, 'frontend-spa-variant')
    expect(entry.verdict).toBe('Y')
  })
})

// ── probeDDomainApi ─────────────────────────────────────────────────────────────

describe('probeDDomainApi', () => {
  it('Y when domain-api-surface.json has non-empty checks', () => {
    const root = tmpRoot()
    writeJson(root, 'domain-api-surface.json', { checks: ['a', 'b'] })
    const entry = probeDDomainApi(root)
    expect(entry.id).toBe('D-DOMAIN-API')
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toContain('2 check(s)')
  })

  it('N when domain-api-surface.json has an empty checks array', () => {
    const root = tmpRoot()
    writeJson(root, 'domain-api-surface.json', { checks: [] })
    const entry = probeDDomainApi(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('empty')
  })

  it('falls through to legacy openapi presence when manifest is malformed', () => {
    const root = tmpRoot()
    // Malformed manifest → readJson null → skip manifest branch, hit legacy fallback.
    writeAt(root, 'domain-api-surface.json', 'not json')
    writeAt(root, 'openapi.yaml', 'openapi: 3.0.0')
    const entry = probeDDomainApi(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { file: string }).file).toBe('openapi.yaml')
  })

  it('Y on legacy pact config when no manifest present', () => {
    const root = tmpRoot()
    writeAt(root, 'pact.config.ts', 'export default {}')
    const entry = probeDDomainApi(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { file: string }).file).toBe('pact.config.ts')
  })

  it('Y on a nested api/openapi.json legacy file', () => {
    const root = tmpRoot()
    writeAt(root, 'api/openapi.json', '{}')
    const entry = probeDDomainApi(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { file: string }).file).toBe('api/openapi.json')
  })

  it('N when neither manifest nor any legacy file is present', () => {
    const entry = probeDDomainApi(tmpRoot())
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('missing')
  })

  it('manifest with non-object body falls through to legacy (N when none)', () => {
    const root = tmpRoot()
    writeJson(root, 'domain-api-surface.json', 42)
    const entry = probeDDomainApi(root)
    expect(entry.verdict).toBe('N')
  })
})

// ── probeDDoneEvidence ──────────────────────────────────────────────────────────

describe('probeDDoneEvidence', () => {
  it('N when done-evidence file is absent', () => {
    const entry = probeDDoneEvidence(tmpRoot())
    expect(entry.id).toBe('D-DONE-EVIDENCE')
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('absent')
  })

  it('N on parse error', () => {
    const root = tmpRoot()
    writeAt(root, '.claude/.last-done-evidence.json', 'broken{')
    const entry = probeDDoneEvidence(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toBe('parse error')
  })

  it('Y when reality_contact.passed is true', () => {
    const root = tmpRoot()
    writeJson(root, '.claude/.last-done-evidence.json', { reality_contact: { passed: true } })
    const entry = probeDDoneEvidence(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toContain('passed=true')
  })

  it('N when reality_contact.passed is false', () => {
    const root = tmpRoot()
    writeJson(root, '.claude/.last-done-evidence.json', { reality_contact: { passed: false } })
    const entry = probeDDoneEvidence(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('not true')
  })

  it('N when reality_contact is missing entirely', () => {
    const root = tmpRoot()
    writeJson(root, '.claude/.last-done-evidence.json', { other: 1 })
    const entry = probeDDoneEvidence(root)
    expect(entry.verdict).toBe('N')
  })
})

// ── probeGateGreen ──────────────────────────────────────────────────────────────

describe('probeGateGreen', () => {
  it('N when gate result file is absent', () => {
    const entry = probeGateGreen(tmpRoot())
    expect(entry.id).toBe('D-GATE-GREEN')
    expect(entry.family).toBe('discipline')
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('not been run')
  })

  it('Y when overall=pass', () => {
    const root = tmpRoot()
    writeJson(root, '.arbiter/gate/local-result.json', { overall: 'pass' })
    const entry = probeGateGreen(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toBe('overall=pass')
  })

  it('N when overall is not pass', () => {
    const root = tmpRoot()
    writeJson(root, '.arbiter/gate/local-result.json', { overall: 'fail' })
    const entry = probeGateGreen(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('not pass')
  })

  it('N on parse error (manifest unreadable)', () => {
    const root = tmpRoot()
    writeAt(root, '.arbiter/gate/local-result.json', 'not json')
    const entry = probeGateGreen(root)
    expect(entry.verdict).toBe('N')
  })
})

// ── probeCoverageThresholds ─────────────────────────────────────────────────────

describe('probeCoverageThresholds', () => {
  it('NV when coverage summary is absent', () => {
    const entry = probeCoverageThresholds(tmpRoot())
    expect(entry.id).toBe('D-COVERAGE-THRESHOLDS')
    expect(entry.verdict).toBe('NV')
    expect((entry.evidence as { detail: string }).detail).toContain('not been collected')
  })

  it('NV on parse error', () => {
    const root = tmpRoot()
    writeAt(root, 'coverage/coverage-summary.json', 'broken')
    const entry = probeCoverageThresholds(root)
    expect(entry.verdict).toBe('NV')
    expect((entry.evidence as { detail: string }).detail).toBe('parse error')
  })

  it('NV when total field is missing', () => {
    const root = tmpRoot()
    writeJson(root, 'coverage/coverage-summary.json', { other: {} })
    const entry = probeCoverageThresholds(root)
    expect(entry.verdict).toBe('NV')
    expect((entry.evidence as { detail: string }).detail).toContain('total field missing')
  })

  it('Y when all metrics meet the threshold', () => {
    const root = tmpRoot()
    writeJson(root, 'coverage/coverage-summary.json', {
      total: {
        lines: { pct: 95 },
        branches: { pct: 90 },
        functions: { pct: 100 },
        statements: { pct: 88 },
      },
    })
    const entry = probeCoverageThresholds(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toContain('>= 80%')
  })

  it('N when one metric is below the threshold', () => {
    const root = tmpRoot()
    writeJson(root, 'coverage/coverage-summary.json', {
      total: {
        lines: { pct: 95 },
        branches: { pct: 50 },
        functions: { pct: 100 },
        statements: { pct: 88 },
      },
    })
    const entry = probeCoverageThresholds(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('branches=50%')
  })

  it('Y when metric entries lack a numeric pct (skipped, none below)', () => {
    const root = tmpRoot()
    writeJson(root, 'coverage/coverage-summary.json', {
      total: {
        lines: { pct: 'n/a' },
        branches: 'not-an-object',
        functions: null,
      },
    })
    const entry = probeCoverageThresholds(root)
    expect(entry.verdict).toBe('Y')
  })
})

// ── probeInvariantsEnforced ─────────────────────────────────────────────────────

describe('probeInvariantsEnforced', () => {
  it('Y when src/invariants/catalog.ts exists', () => {
    const root = tmpRoot()
    writeAt(root, 'src/invariants/catalog.ts', 'export const catalog = []')
    const entry = probeInvariantsEnforced(root)
    expect(entry.id).toBe('D-INVARIANTS-ENFORCED')
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { file: string }).file).toBe('src/invariants/catalog.ts')
  })

  it('Y when .arbiter/invariants.json exists (generated-project path)', () => {
    const root = tmpRoot()
    writeJson(root, '.arbiter/invariants.json', { invariants: [] })
    const entry = probeInvariantsEnforced(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { file: string }).file).toBe('.arbiter/invariants.json')
  })

  it('NV when no invariants catalog is found', () => {
    const entry = probeInvariantsEnforced(tmpRoot())
    expect(entry.verdict).toBe('NV')
    expect((entry.evidence as { detail: string }).detail).toContain('no invariants catalog')
  })
})

// ── probeNoOverclaim ────────────────────────────────────────────────────────────

describe('probeNoOverclaim', () => {
  it('NV when done-evidence is absent', () => {
    const entry = probeNoOverclaim(tmpRoot())
    expect(entry.id).toBe('D-NO-OVERCLAIM')
    expect(entry.verdict).toBe('NV')
    expect((entry.evidence as { detail: string }).detail).toContain('absent')
  })

  it('Y when no_overclaim is true', () => {
    const root = tmpRoot()
    writeJson(root, '.claude/.last-done-evidence.json', { no_overclaim: true })
    const entry = probeNoOverclaim(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toBe('no_overclaim=true')
  })

  it('N when no_overclaim is not true', () => {
    const root = tmpRoot()
    writeJson(root, '.claude/.last-done-evidence.json', { no_overclaim: false })
    const entry = probeNoOverclaim(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('not true')
  })

  it('N on parse error (present but unparseable → falls through to N)', () => {
    const root = tmpRoot()
    writeAt(root, '.claude/.last-done-evidence.json', 'broken{')
    const entry = probeNoOverclaim(root)
    expect(entry.verdict).toBe('N')
  })
})

// ── probeCommitHygiene ──────────────────────────────────────────────────────────

describe('probeCommitHygiene', () => {
  it('Y when both .husky/ and .commitlintrc.json are present', () => {
    const root = tmpRoot()
    mkdirSync(join(root, '.husky'), { recursive: true })
    writeJson(root, '.commitlintrc.json', { extends: ['@commitlint/config-conventional'] })
    const entry = probeCommitHygiene(root)
    expect(entry.id).toBe('D-COMMIT-HYGIENE')
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toContain('present')
  })

  it('N when .husky/ is missing', () => {
    const root = tmpRoot()
    writeJson(root, '.commitlintrc.json', {})
    const entry = probeCommitHygiene(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('.husky/')
  })

  it('N when .commitlintrc.json is missing', () => {
    const root = tmpRoot()
    mkdirSync(join(root, '.husky'), { recursive: true })
    const entry = probeCommitHygiene(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('.commitlintrc.json')
  })

  it('N when both are missing (lists both)', () => {
    const entry = probeCommitHygiene(tmpRoot())
    expect(entry.verdict).toBe('N')
    const detail = (entry.evidence as { detail: string }).detail
    expect(detail).toContain('.husky/')
    expect(detail).toContain('.commitlintrc.json')
  })
})

// ── probeFindingHygiene ─────────────────────────────────────────────────────────

describe('probeFindingHygiene', () => {
  function findingAt(daysAgo: number, fp: string): Record<string, unknown> {
    const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
    return { ts, fingerprint: fp, kind: 'smell' }
  }

  function writeSpool(root: string, shard: string, entries: Array<Record<string, unknown>>): void {
    const dir = join(root, '.arbiter', 'findings')
    mkdirSync(dir, { recursive: true })
    const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '')
    writeFileSync(join(dir, `${shard}.jsonl`), body, 'utf-8')
  }

  function writePrior(root: string, count: number): void {
    const dir = join(root, '.arbiter')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'finding-hygiene-baseline.json'), JSON.stringify({ openFindingsCount: count }))
  }

  it('NA when the spool directory is absent', () => {
    const entry = probeFindingHygiene(tmpRoot())
    expect(entry.id).toBe('DISC-finding-hygiene')
    expect(entry.verdict).toBe('NA')
  })

  it('Y when the spool is drained (empty dir, 0 findings)', () => {
    const root = tmpRoot()
    mkdirSync(join(root, '.arbiter', 'findings'), { recursive: true })
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toContain('drained')
  })

  it('Y when fresh findings exist and no prior baseline (bootstrap)', () => {
    const root = tmpRoot()
    writeSpool(root, 'shard', [findingAt(1, 'fp1'), findingAt(2, 'fp2')])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('Y')
    expect((entry.evidence as { detail: string }).detail).toContain('open finding')
  })

  it('N when openFindingsCount regresses vs prior', () => {
    const root = tmpRoot()
    writePrior(root, 1)
    writeSpool(root, 'shard', [findingAt(1, 'a'), findingAt(1, 'b'), findingAt(1, 'c')])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('rose')
  })

  it('P when oldest finding is stale (> 14 days) with no count regression', () => {
    const root = tmpRoot()
    writePrior(root, 1)
    writeSpool(root, 'shard', [findingAt(40, 'fp1')])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('P')
    expect((entry.evidence as { detail: string }).detail).toContain('40d')
  })

  it('dedups fingerprints across multiple shards', () => {
    const root = tmpRoot()
    writePrior(root, 2)
    // Same fingerprint in two shards counts once → openCount stays 1, no regression.
    writeSpool(root, 'shardA', [findingAt(1, 'dup')])
    writeSpool(root, 'shardB', [findingAt(2, 'dup')])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('Y')
  })

  it('is fail-safe on malformed JSONL lines (skips them, no throw)', () => {
    const root = tmpRoot()
    const dir = join(root, '.arbiter', 'findings')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'shard.jsonl'), 'not json\n{broken\n\n  \n', 'utf-8')
    let entry: ReturnType<typeof probeFindingHygiene> | undefined
    expect(() => {
      entry = probeFindingHygiene(root)
    }).not.toThrow()
    // All lines unparseable / blank → drained.
    expect(entry?.verdict).toBe('Y')
  })

  it('uses the raw line as fingerprint when the field is absent (still dedup-safe)', () => {
    const root = tmpRoot()
    // Entries without a fingerprint field; valid objects, no ts → oldestTs stays null.
    writeSpool(root, 'shard', [{ kind: 'smell' }, { kind: 'risk' }])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('Y')
  })

  it('ignores a non-object baseline (treated as no prior)', () => {
    const root = tmpRoot()
    writeAt(root, '.arbiter/finding-hygiene-baseline.json', '"not-an-object"')
    writeSpool(root, 'shard', [findingAt(1, 'fp1')])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('Y')
  })

  it('skips non-object JSONL entries (arrays/primitives) without counting them', () => {
    const root = tmpRoot()
    const dir = join(root, '.arbiter', 'findings')
    mkdirSync(dir, { recursive: true })
    // Valid JSON but not objects → skipped; result is a drained spool.
    writeFileSync(join(dir, 'shard.jsonl'), '[1,2]\n42\nnull\n', 'utf-8')
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('Y')
  })
})
