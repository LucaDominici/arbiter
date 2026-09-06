// SPDX-License-Identifier: Apache-2.0
// #2411: stale paths and counts across docs/internal/{PRODUCT,METHOD,DEVELOPMENT} + README,
// found by the 2026-08-29 audit (ADEQUACY-MAP §2). Each assertion below pins a fact the
// audit found wrong and that the fix must make true.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(resolve(p), 'utf8')

const ssotCoreSet = read('docs/internal/METHOD/SSOT_CORE_SET.md')
const process_ = read('docs/internal/METHOD/PROCESS.md')
const prdDocsEvolution = read('docs/internal/PRODUCT/PRD-DOCS-EVOLUTION.md')
const patternsCatalog = read('docs/internal/METHOD/PATTERNS_CATALOG.md')
const milestones = read('docs/internal/PRODUCT/MILESTONES.md')
const canonicalPaths = read('docs/internal/METHOD/CANONICAL_PATHS.md')
const engineeringDefaults = read('docs/internal/METHOD/ENGINEERING_DEFAULTS.md')
const reuseRegistry = read('docs/internal/METHOD/REUSE_REGISTRY.md')
const conformance = read('docs/internal/DEVELOPMENT/CONFORMANCE.md')
const realProjectTesting = read('docs/internal/DEVELOPMENT/REAL-PROJECT-TESTING.md')
const readme = read('README.md')
const helpSurfaceTest = read('__tests__/behavioral/help-surface.test.ts')
const ssotNavigationSkill = read('.claude/skills/ssot-navigation/SKILL.md')
const enterpriseDocStandard = read('docs/research/enterprise-doc-standard-2026.md')
const allowlist = JSON.parse(read('scripts/data/doc-gate-allowlist.json')) as {
  entries: Array<{ path: string; issue?: string }>
}

// docs/ADR/ was renamed docs/internal/ADR/ — bare `docs/ADR/` is a dead path. Scoped to the
// three files the audit named for this rewrite (CANONICAL_PATHS.md legitimately keeps
// `docs/ADR` in its historical alias rows forever; MILESTONES.md M1-M4 is banner-exempt).
describe('#2411 — docs/ADR/ renamed to docs/internal/ADR/', () => {
  it('SSOT_CORE_SET.md no longer cites the dead docs/ADR/ path', () => {
    expect(ssotCoreSet).not.toContain('docs/ADR/')
    expect(ssotCoreSet).toContain('docs/internal/ADR/')
  })

  it('PROCESS.md no longer cites the dead docs/ADR/ path', () => {
    expect(process_).not.toContain('docs/ADR/')
  })

  it('PRD-DOCS-EVOLUTION.md no longer cites the dead docs/ADR/ path', () => {
    expect(prdDocsEvolution).not.toContain('docs/ADR/')
    expect(prdDocsEvolution).toContain('docs/internal/ADR/')
  })

  it('MILESTONES.md M8 deliverables no longer cite the dead docs/ADR/ path', () => {
    expect(milestones).toContain('docs/internal/ADR/012-doc-enforcement.md')
    expect(milestones).toContain('docs/internal/ADR/013-testing-matrix.md')
  })
})

describe('#2411 — PROCESS.md stale references', () => {
  it('drops the deleted scripts/knowledge-map-update.mjs instruction', () => {
    expect(process_).not.toContain('knowledge-map-update.mjs')
  })

  it('does not claim docs/rfc/ as a live path with a template to copy', () => {
    // The RFC template + docs/rfc/ directory were deleted in ec9b2c2b (#1244); the RFC
    // process must not instruct copying a template that no longer exists.
    expect(process_).not.toMatch(/Copy\*\* the RFC template/)
  })

  it('the bloat-baseline generator (line ~249) still names the script check-all.mjs actually uses', () => {
    expect(process_).toContain('scripts/update-bloat-baseline.mjs')
  })
})

describe('#2411 — PATTERNS_CATALOG.md stale references', () => {
  it('cites the current thresholds module path', () => {
    expect(patternsCatalog).not.toContain('thresholds-l1-l2-l3.ts')
    expect(patternsCatalog).toContain('src/kit/thresholds.ts')
  })

  it('cites docs/internal/SYSTEM/, not the dead docs/SYSTEM/', () => {
    expect(patternsCatalog).not.toContain('docs/SYSTEM/')
    expect(patternsCatalog).toContain('docs/internal/SYSTEM/')
  })
})

describe('#2411 — MILESTONES.md stale references', () => {
  it('M8 and M12 cite the real ci.yml.ejs template path', () => {
    expect(milestones).toContain('src/templates/github/workflows/five-lane/ci.yml.ejs')
    expect(milestones).not.toContain('`src/templates/github/ci.yml.ejs`')
  })

  it('M25 evidence-collect deliverable resolves to a real template path', () => {
    expect(milestones).toContain('evidence-collect.mjs.ejs')
    expect(existsSync(resolve('src/templates/scripts/evidence-collect.mjs.ejs'))).toBe(true)
  })

  it('M27 check-test-naming deliverable resolves to a real template path', () => {
    expect(milestones).toContain('src/templates/scripts/check-test-naming.mjs.ejs')
    expect(existsSync(resolve('src/templates/scripts/check-test-naming.mjs.ejs'))).toBe(true)
  })

  it('GAP.md is recorded as landed, not "not yet on main"', () => {
    expect(milestones).not.toContain('not yet on `main`')
    expect(existsSync(resolve('docs/internal/SYSTEM/GAP.md'))).toBe(true)
  })

  it('carries a historical-paths banner covering the M1-M4 deliverable section', () => {
    expect(milestones).toMatch(/Historical — paths superseded/)
  })
})

describe('#2411 — PRD-DOCS-EVOLUTION.md counts do not overclaim', () => {
  it('does not assert the stale 333-doc baseline as a live count', () => {
    expect(prdDocsEvolution).not.toContain('333')
  })

  it('does not assert a fixed ADR file count', () => {
    expect(prdDocsEvolution).not.toMatch(/ADR\/\*\*\s*\(\d+\s*files\)/)
  })
})

// Correction: the #1242 consolidation invariant (__tests__/docs/consolidation-1242.test.ts)
// requires the alias row to stay forever, append-only, even though docs/QUICKSTART.md was
// later deliberately repurposed as its own doc (T7, #1770) — same precedent already applied
// to docs/architecture/README.md in that test. Removing the row broke that invariant, so the
// row is kept; this is documented behavior, not a bug this issue fixes.
describe('#2411 — CANONICAL_PATHS.md QUICKSTART alias stays (append-only trail)', () => {
  it('docs/QUICKSTART.md exists again as its own doc, and the historical alias row is preserved per policy', () => {
    expect(existsSync(resolve('docs/QUICKSTART.md'))).toBe(true)
    expect(canonicalPaths).toMatch(/`docs\/QUICKSTART\.md`\s*\|\s*`docs\/CONTRIBUTING\.md`/)
  })
})

describe('#2411 — ENGINEERING_DEFAULTS.md complexity limits and detector scope', () => {
  it('nesting-depth and lines-per-function limits match the eslint config actually enforced', () => {
    expect(engineeringDefaults).toContain('| Nesting depth                     | 4     |')
    expect(engineeringDefaults).toContain('| Lines per function                | 100   |')
  })

  it('Scope section reflects that all 14 detector files are covered, not just 3', () => {
    expect(engineeringDefaults).not.toMatch(
      /Applies to: `src\/detectors\/build\.ts`, `src\/detectors\/framework\.ts`,\s*\n`src\/detectors\/scaffold-wiring\.ts`, and any future detector/,
    )
    expect(engineeringDefaults).toMatch(/every file under `src\/detectors\/`/)
  })

  it('does not overclaim readFileSync is forbidden when it is not gate-enforced', () => {
    expect(engineeringDefaults).not.toContain(
      'Direct `readFileSync` calls are forbidden in detectors.',
    )
  })
})

describe('#2411 — REUSE_REGISTRY.md dead entries and level range', () => {
  it('drops the 4 entries whose source files no longer exist', () => {
    expect(reuseRegistry).not.toMatch(/^### perf$/m)
    expect(reuseRegistry).not.toMatch(/^### release-bucket$/m)
    expect(reuseRegistry).not.toMatch(/^### seed$/m)
    expect(reuseRegistry).not.toMatch(/^### vault-sync$/m)
  })

  it('every remaining entry path actually exists', () => {
    const pathLines = [...reuseRegistry.matchAll(/^- path: (\S+)$/gm)].map((m) => m[1])
    expect(pathLines.length).toBeGreaterThan(0)
    for (const p of pathLines) {
      expect(existsSync(resolve(p))).toBe(true)
    }
  })

  it('cites the real L1-L4 level range, not L1-L5', () => {
    expect(reuseRegistry).not.toContain('L1–L5')
    expect(reuseRegistry).toContain('L1–L4')
  })
})

describe('#2411 — CONFORMANCE.md lists all 10 dimensions', () => {
  const dimensionIds = [
    'D-TEST-LEVELS',
    'D-LIVE-E2E',
    'D-FE-RENDER-GATE',
    'D-DOMAIN-API',
    'D-DONE-EVIDENCE',
    'D-GATE-GREEN',
    'D-COVERAGE-THRESHOLDS',
    'D-INVARIANTS-ENFORCED',
    'D-NO-OVERCLAIM',
    'D-COMMIT-HYGIENE',
  ]

  it.each(dimensionIds)('table includes %s', (id) => {
    expect(conformance).toContain(id)
  })

  it('no longer lists shipped dimensions (gate green/coverage/invariants/no-overclaim) as deferred', () => {
    expect(conformance).not.toMatch(
      /Additional discipline dimensions: gate green, coverage, invariants, no overclaim/,
    )
  })
})

describe('#2411 — REAL-PROJECT-TESTING.md paths and fixture set', () => {
  it('bake harness path matches the real __tests__/integration/e2e/ location', () => {
    expect(realProjectTesting).not.toContain('`__tests__/e2e/bake/`')
    expect(realProjectTesting).toContain('__tests__/integration/e2e/bake/')
  })

  it('does not claim a dead 25-matrix-job aggregate-≥10 threshold', () => {
    expect(realProjectTesting).not.toMatch(/25 matrix jobs/)
    expect(realProjectTesting).not.toMatch(/aggregate step requires ≥10 to pass/)
    expect(realProjectTesting).not.toMatch(/only N of ≥10 passed/)
  })

  it('fixture table lists every real fixture directory under __tests__/fixtures/real-projects/', () => {
    const fixturesDir = resolve('__tests__/fixtures/real-projects')
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
    const dirs = readdirSync(fixturesDir).filter((name) =>
      statSync(resolve(fixturesDir, name)).isDirectory(),
    )
    expect(dirs.length).toBeGreaterThanOrEqual(29)
    for (const dir of dirs) {
      expect(realProjectTesting).toContain(`\`${dir}\``)
    }
  })
})

describe('#2411 — README.md stack table and cadence claims', () => {
  it('lists Kotlin in the stack table', () => {
    expect(readme).toMatch(/\|\s*Kotlin\s*\|/)
  })

  it('Java Format cell matches cross-language-matrix.json (spotless, not "—")', () => {
    const javaRow = readme.split('\n').find((l) => l.trim().startsWith('| Java'))
    expect(javaRow).toBeDefined()
    expect(javaRow).toContain('spotless')
  })

  it('generator-matrix cadence is described as weekly + pre-release, not "every run"', () => {
    expect(readme).not.toMatch(/regenerates all three on every\s*\nrun/)
    expect(readme).toMatch(/weekly cadence and before every pre-release/)
  })
})

describe('#2411 — help-surface.test.ts command count', () => {
  it('describe title says 16-command, matching the real public CLI surface (#2416 added plugin)', () => {
    expect(helpSurfaceTest).toContain('16-command')
    expect(helpSurfaceTest).not.toContain('14-command')
    expect(helpSurfaceTest).not.toContain('15-command')
  })
})

describe('#2411 — allowlist entries owned by this issue are resolved and removed', () => {
  it('ssot-navigation SKILL.md recipe no longer invokes the unregistered `arbiter invariants list`', () => {
    expect(ssotNavigationSkill).not.toContain('arbiter invariants list')
  })

  it('enterprise-doc-standard-2026.md frontmatter no longer cites nonexistent related docs', () => {
    expect(enterpriseDocStandard).not.toContain('docs/audit/IS-ARBITER-WORTH-IT.md')
    expect(enterpriseDocStandard).not.toContain('docs/design/solo-developer-gate-model.md')
  })

  it('the two #2411-owned allowlist entries are removed', () => {
    const owned = allowlist.entries.filter((e) => e.issue === '#2411')
    expect(owned).toHaveLength(0)
  })
})
