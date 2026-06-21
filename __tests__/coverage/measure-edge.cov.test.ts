// SPDX-License-Identifier: Apache-2.0
//
// Edge-branch coverage for src/kit/measure.ts — complements measure.cov.test.ts.
// This file targets the REMAINING uncovered branches that the prior cov test
// does not exercise: helper guards (readPkgJson cache/malformed, hasScript false,
// findRecursive depth, checkDir readdir/stat/empty, readWorkflowFile non-file/large,
// fileContains non-file, globWorkflows error), and every handler (N09/N17/N18/
// N24/N25/N26/N27/N30/N34/N35/N39/N41/N46-N50/N53/N55/N56/N59/N61/N62/N63/N69/N70/
// N78) plus their flag combinations (present / partial / missing / fallback).
//
// Strategy: real isolated mkdtempSync temp repos (no network, no git, no gh,
// no spawn). Each repo is removed in withRepo's finally. Deterministic + fast.
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  measureDim,
  clearMeasureCache,
  getMeasureDiagnosticErrors,
  type MeasureResult,
} from '../../src/kit/measure.js'
import type { KitDimension } from '../../src/kit/schema.js'

// ─── Helpers (mirrors the prior cov test's fixture pattern) ──────────────────

function makeDim(overrides: Partial<KitDimension> = {}): KitDimension {
  return {
    id: 'N01',
    name: 'Test dim',
    tml: 'M',
    gate: 'L1',
    categoryRef: 'testing',
    archetypeGating: { applies: [], excludes: [] },
    status: 'covered',
    ...overrides,
  }
}

function dim(id: string, categoryRef = 'testing'): KitDimension {
  return makeDim({ id, categoryRef })
}

/** Create a fresh isolated temp repo, run fn inside it, then remove it. */
function withRepo(fn: (root: string) => void): void {
  const root: string = mkdtempSync(join(tmpdir(), 'arbiter-cov-measure-edge-'))
  try {
    clearMeasureCache()
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function write(root: string, rel: string, content = ''): void {
  const abs: string = join(root, rel)
  const lastSlash: number = abs.lastIndexOf('/')
  if (lastSlash > 0) mkdirSync(abs.slice(0, lastSlash), { recursive: true })
  writeFileSync(abs, content)
}

function mkdir(root: string, rel: string): void {
  mkdirSync(join(root, rel), { recursive: true })
}

function measure(id: string, root: string): MeasureResult {
  return measureDim(dim(id), root)
}

beforeEach(() => {
  clearMeasureCache()
})

// ─── readPkgJson: cache hit + malformed-JSON catch branches ──────────────────

describe('readPkgJson cache + malformed-JSON branches', () => {
  it('serves a second dependency-reading dim from the cached package.json (cache-hit branch)', () => {
    withRepo((root: string) => {
      // Both N14 (knip) and N15 (jscpd) read package.json. First call populates
      // the pkgCache; the second hits the `cached !== undefined` early return.
      write(root, 'package.json', JSON.stringify({ devDependencies: { knip: '^5', jscpd: '^4' } }))
      const knip: MeasureResult = measure('N14', root)
      const jscpd: MeasureResult = measure('N15', root)
      expect(knip.status).toBe('present')
      expect(jscpd.status).toBe('present')
    })
  })

  it('caches null for malformed package.json so a dep lookup is missing (JSON.parse catch)', () => {
    withRepo((root: string) => {
      // Invalid JSON → readPkgJson catch → pkgCache=null → hasDep false → missing.
      write(root, 'package.json', '{ this is : not valid json,,, }')
      const result: MeasureResult = measure('N14', root)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    })
  })
})

// ─── hasScript false branch + null-pkg guard ─────────────────────────────────

describe('hasScript / hasDep null-pkg guards', () => {
  it('N24 missing when package.json has no scripts object and no vitest hint (hasScript false)', () => {
    withRepo((root: string) => {
      write(root, 'package.json', JSON.stringify({ name: 'x' }))
      const result: MeasureResult = measure('N24', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N24 missing when package.json absent entirely (hasScript on null pkg)', () => {
    withRepo((root: string) => {
      // No package.json, no vitest config → readPkgJson null → hasScript(null) false.
      const result: MeasureResult = measure('N24', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N24 test_profiles: present (script) and partial (vitest exclude) ────────

describe('N24 test:unit profile', () => {
  it('present via test:unit script', () => {
    withRepo((root: string) => {
      write(root, 'package.json', JSON.stringify({ scripts: { 'test:unit': 'vitest run unit' } }))
      const result: MeasureResult = measure('N24', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('partial via vitest config exclude heuristic (no test:unit script)', () => {
    withRepo((root: string) => {
      write(root, 'package.json', '{}')
      write(root, 'vitest.config.ts', 'export default { test: { exclude: ["**/e2e/**"] } }')
      const result: MeasureResult = measure('N24', root)
      expect(result.status).toBe('partial')
      expect(result.evidence).toContain('vitest.config.ts')
    })
  })
})

// ─── N25 test_integration profile: present / partial / missing ───────────────

describe('N25 test:integration profile', () => {
  it('present via test:integration script', () => {
    withRepo((root: string) => {
      write(root, 'package.json', JSON.stringify({ scripts: { 'test:integration': 'vitest int' } }))
      const result: MeasureResult = measure('N25', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('partial via integration-matching workflow (no script)', () => {
    withRepo((root: string) => {
      write(root, 'package.json', '{}')
      write(root, '.github/workflows/it.yml', 'name: integration suite\non:\n  push:\n')
      const result: MeasureResult = measure('N25', root)
      expect(result.status).toBe('partial')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('missing when neither script nor integration workflow', () => {
    withRepo((root: string) => {
      write(root, 'package.json', '{}')
      const result: MeasureResult = measure('N25', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N26 scheduled-workflow profile: present / missing ───────────────────────

describe('N26 scheduled workflow', () => {
  it('present when a workflow contains schedule:', () => {
    withRepo((root: string) => {
      write(
        root,
        '.github/workflows/cron.yml',
        'name: cron\non:\n  schedule:\n    - cron: "0 1 * * *"\n',
      )
      const result: MeasureResult = measure('N26', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('missing when workflows exist but none are scheduled', () => {
    withRepo((root: string) => {
      write(root, '.github/workflows/ci.yml', 'name: ci\non:\n  push:\n')
      const result: MeasureResult = measure('N26', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N27 integration tests: dir / Java IT / missing ──────────────────────────

describe('N27 integration tests', () => {
  it('present via __tests__/integration dir', () => {
    withRepo((root: string) => {
      write(root, '__tests__/integration/api.test.ts', '// it')
      const result: MeasureResult = measure('N27', root)
      expect(result.status).toBe('present')
    })
  })

  it('present via Java *IT.java when no integration dir', () => {
    withRepo((root: string) => {
      write(root, 'src/test/java/OrderServiceIT.java', 'class OrderServiceIT {}')
      const result: MeasureResult = measure('N27', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('missing when no integration signals', () => {
    withRepo((root: string) => {
      const result: MeasureResult = measure('N27', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N30 archunit test-types: present / missing (no dep) ─────────────────────

describe('N30 archunit test type', () => {
  it('present when archunit dep + ArchTest class present', () => {
    withRepo((root: string) => {
      write(root, 'build.gradle', 'testImplementation "com.tngtech.archunit:archunit-junit5"')
      write(root, 'src/test/java/LayerArchTest.java', 'class LayerArchTest {}')
      const result: MeasureResult = measure('N30', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('missing when archunit dep present but no ArchTest class (N30 has no partial path)', () => {
    withRepo((root: string) => {
      write(root, 'pom.xml', '<dependency>archunit-junit5</dependency>')
      const result: MeasureResult = measure('N30', root)
      // N30 returns missing (not partial) when dep present but no ArchTest classes.
      expect(result.status).toBe('missing')
    })
  })

  it('missing when no archunit dep at all', () => {
    withRepo((root: string) => {
      write(root, 'pom.xml', '<project></project>')
      const result: MeasureResult = measure('N30', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N34 multiple-workflows: present (>=2) / missing (<2) ─────────────────────

describe('N34 multiple workflows', () => {
  it('present when two or more workflow files exist', () => {
    withRepo((root: string) => {
      write(root, '.github/workflows/ci.yml', 'name: ci\n')
      write(root, '.github/workflows/release.yaml', 'name: release\n')
      const result: MeasureResult = measure('N34', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('missing when fewer than two workflows', () => {
    withRepo((root: string) => {
      write(root, '.github/workflows/ci.yml', 'name: ci\n')
      const result: MeasureResult = measure('N34', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N35 pull_request: missing branch (no PR-triggered workflow) ─────────────

describe('N35 pull_request workflow', () => {
  it('missing when no workflow references pull_request', () => {
    withRepo((root: string) => {
      write(root, '.github/workflows/push.yml', 'name: push\non:\n  push:\n')
      const result: MeasureResult = measure('N35', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N39 self-hosted runner: present / partial / missing ─────────────────────

describe('N39 CI_BUILD_RUNNER_LABEL', () => {
  it('present when a workflow references CI_BUILD_RUNNER_LABEL', () => {
    withRepo((root: string) => {
      write(
        root,
        '.github/workflows/ci.yml',
        'name: ci\njobs:\n  build:\n    runs-on: ${{ vars.CI_BUILD_RUNNER_LABEL }}\n',
      )
      const result: MeasureResult = measure('N39', root)
      expect(result.status).toBe('present')
    })
  })

  it('partial when workflows exist but none reference the runner label', () => {
    withRepo((root: string) => {
      write(root, '.github/workflows/ci.yml', 'name: ci\njobs:\n  build:\n    runs-on: ubuntu\n')
      const result: MeasureResult = measure('N39', root)
      expect(result.status).toBe('partial')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('missing when no workflows at all', () => {
    withRepo((root: string) => {
      const result: MeasureResult = measure('N39', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N09/N17/N18 present paths via checkAny / fileContains threshold ──────────

describe('static analysis + test framework present paths', () => {
  it('N09 present via eslint.config.mjs', () => {
    withRepo((root: string) => {
      write(root, 'eslint.config.mjs', 'export default []')
      const result: MeasureResult = measure('N09', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('eslint.config.mjs')
    })
  })

  it('N09 missing when no linter config', () => {
    withRepo((root: string) => {
      const result: MeasureResult = measure('N09', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N17 present via vitest.config.ts', () => {
    withRepo((root: string) => {
      write(root, 'vitest.config.ts', 'export default {}')
      const result: MeasureResult = measure('N17', root)
      expect(result.status).toBe('present')
    })
  })

  it('N18 present via vitest config thresholds (existsSync && fileContains true)', () => {
    withRepo((root: string) => {
      write(
        root,
        'vitest.config.ts',
        'export default { test: { coverage: { thresholds: { lines: 90 } } } }',
      )
      const result: MeasureResult = measure('N18', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('vitest.config.ts')
    })
  })

  it('N18 missing when vitest config exists but has no threshold keys (fileContains false)', () => {
    withRepo((root: string) => {
      // existsSync true, fileContains false → neither candidate pushed → missing.
      write(root, 'vitest.config.ts', 'export default { test: { globals: true } }')
      const result: MeasureResult = measure('N18', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── fileContains non-file guard: a directory named build.gradle ─────────────

describe('fileContains non-regular-file guard', () => {
  it('N18 missing when build.gradle is a directory (st.isFile() false → fileContains false)', () => {
    withRepo((root: string) => {
      // statSync succeeds but !isFile() → fileContains returns false, no jacoco match.
      mkdir(root, 'build.gradle')
      const result: MeasureResult = measure('N18', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── checkDir guards: readdir error (ENOTDIR), empty dir, non-file entries ────

describe('checkDir error / empty / non-file branches', () => {
  it('N62 missing when .github/ISSUE_TEMPLATE is a regular file (readdirSync ENOTDIR catch)', () => {
    withRepo((root: string) => {
      // existsSync true (it is a file), readdirSync throws ENOTDIR → caught → missing.
      write(root, '.github/ISSUE_TEMPLATE', 'not a directory')
      const result: MeasureResult = measure('N62', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N62 present when ISSUE_TEMPLATE dir holds a file', () => {
    withRepo((root: string) => {
      write(root, '.github/ISSUE_TEMPLATE/bug.md', '# bug')
      const result: MeasureResult = measure('N62', root)
      expect(result.status).toBe('present')
    })
  })

  it('N62 missing when ISSUE_TEMPLATE dir contains only a subdirectory (no regular files)', () => {
    withRepo((root: string) => {
      // dir exists, readdir returns one entry which is a subdir → statSync.isFile() false
      // → matching empty → missing.
      mkdir(root, '.github/ISSUE_TEMPLATE/nested')
      const result: MeasureResult = measure('N62', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N62 missing when ISSUE_TEMPLATE dir is empty', () => {
    withRepo((root: string) => {
      mkdir(root, '.github/ISSUE_TEMPLATE')
      const result: MeasureResult = measure('N62', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── findRecursive depth-exhaustion guard ────────────────────────────────────

describe('findRecursive depth guard', () => {
  it('N08 does not find an audit file buried past the depth limit', () => {
    withRepo((root: string) => {
      // findRecursive starts at src with remainingDepth 12; build > 12 nested dirs.
      const deep: string = 'src/' + Array.from({ length: 16 }, (_v, i: number) => `d${i}`).join('/')
      write(root, `${deep}/AuditEventService.ts`, 'export {}')
      const result: MeasureResult = measure('N08', root)
      // Too deep → depth guard returns before matching → missing.
      expect(result.status).toBe('missing')
    })
  })
})

// ─── readWorkflowFile guards: large file + non-file entry ────────────────────

describe('readWorkflowFile guards', () => {
  it('N35 ignores an oversized workflow file (>1MB skipped, content not cached)', () => {
    withRepo((root: string) => {
      // A >1MB workflow that DOES say pull_request must be skipped → cache lacks it → missing.
      const big: string = 'on:\n  pull_request:\n' + '#'.repeat(1_100_000)
      write(root, '.github/workflows/huge.yml', big)
      const result: MeasureResult = measure('N35', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N35 tolerates a directory entry shaped like a workflow file (statSync non-file)', () => {
    withRepo((root: string) => {
      // ".github/workflows/weird.yml" is itself a directory: readdir lists it,
      // readWorkflowFile's statSync says !isFile() → null → not cached.
      mkdir(root, '.github/workflows/weird.yml')
      // and a real PR workflow alongside it so the loop still produces a hit.
      write(root, '.github/workflows/pr.yml', 'on:\n  pull_request:\n')
      const result: MeasureResult = measure('N35', root)
      expect(result.status).toBe('present')
    })
  })
})

// ─── globWorkflows: directory absent (early return []) ───────────────────────

describe('globWorkflows missing dir', () => {
  it('N34 missing when .github/workflows directory does not exist', () => {
    withRepo((root: string) => {
      write(root, 'README.md', '# x')
      const result: MeasureResult = measure('N34', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── Simple checkAny single-file handlers (cover present + first-rel branch) ──

describe('simple checkAny handlers — present paths', () => {
  it('N41 present via playwright.config.ts', () => {
    withRepo((root: string) => {
      write(root, 'playwright.config.ts', 'export default {}')
      expect(measure('N41', root).status).toBe('present')
    })
  })

  it('N46 present via check-spdx-headers.mjs', () => {
    withRepo((root: string) => {
      write(root, 'scripts/check-spdx-headers.mjs', '// spdx')
      expect(measure('N46', root).status).toBe('present')
    })
  })

  it('N47 present via check-no-orphan-todo.mjs', () => {
    withRepo((root: string) => {
      write(root, 'scripts/check-no-orphan-todo.mjs', '// todo')
      expect(measure('N47', root).status).toBe('present')
    })
  })

  it('N48 present via check-no-placeholders.mjs', () => {
    withRepo((root: string) => {
      write(root, 'scripts/check-no-placeholders.mjs', '// ph')
      expect(measure('N48', root).status).toBe('present')
    })
  })

  it('N49 present via check-doc-links.mjs', () => {
    withRepo((root: string) => {
      write(root, 'scripts/check-doc-links.mjs', '// links')
      expect(measure('N49', root).status).toBe('present')
    })
  })

  it('N50 present via check-bloat-ratchet.mjs', () => {
    withRepo((root: string) => {
      write(root, 'scripts/check-bloat-ratchet.mjs', '// bloat')
      expect(measure('N50', root).status).toBe('present')
    })
  })

  it('N53 present via api-snapshot.json (second-rel checkAny branch)', () => {
    withRepo((root: string) => {
      // first candidate (check-api-snapshot.mjs) absent → loop continues to api-snapshot.json
      write(root, 'api-snapshot.json', '{}')
      const result: MeasureResult = measure('N53', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('api-snapshot.json')
    })
  })

  it('N53 missing when neither api-snapshot signal present', () => {
    withRepo((root: string) => {
      const result: MeasureResult = measure('N53', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N59 present via commitlint.config.cjs', () => {
    withRepo((root: string) => {
      write(root, 'commitlint.config.cjs', 'module.exports = {}')
      expect(measure('N59', root).status).toBe('present')
    })
  })

  it('N61 present via .github/pull_request_template.md', () => {
    withRepo((root: string) => {
      write(root, '.github/pull_request_template.md', '## PR')
      expect(measure('N61', root).status).toBe('present')
    })
  })

  it('N69 present via .nvmrc', () => {
    withRepo((root: string) => {
      write(root, '.nvmrc', '22')
      expect(measure('N69', root).status).toBe('present')
    })
  })
})

// ─── N55/N56 security: config / partial-workflow / missing ───────────────────

describe('N55 gitleaks', () => {
  it('present via .gitleaks.toml config', () => {
    withRepo((root: string) => {
      write(root, '.gitleaks.toml', '[allowlist]')
      expect(measure('N55', root).status).toBe('present')
    })
  })

  it('partial via gitleaks workflow only (no config)', () => {
    withRepo((root: string) => {
      write(root, '.github/workflows/sec.yml', 'name: sec\nsteps:\n  - uses: gitleaks/gitleaks-action\n')
      const result: MeasureResult = measure('N55', root)
      expect(result.status).toBe('partial')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('missing when no gitleaks signal', () => {
    withRepo((root: string) => {
      expect(measure('N55', root).status).toBe('missing')
    })
  })
})

describe('N56 dependency audit', () => {
  it('present via .audit-ci.json config', () => {
    withRepo((root: string) => {
      write(root, '.audit-ci.json', '{}')
      expect(measure('N56', root).status).toBe('present')
    })
  })

  it('partial via npm-audit workflow only', () => {
    withRepo((root: string) => {
      write(root, '.github/workflows/audit.yml', 'name: audit\nsteps:\n  - run: npm audit\n')
      const result: MeasureResult = measure('N56', root)
      expect(result.status).toBe('partial')
    })
  })

  it('missing when no audit signal', () => {
    withRepo((root: string) => {
      expect(measure('N56', root).status).toBe('missing')
    })
  })
})

// ─── N63 second-candidate (.claude/CLAUDE.md only) ───────────────────────────

describe('N63 docs governance', () => {
  it('present via .claude/CLAUDE.md alone (second checkAny candidate)', () => {
    withRepo((root: string) => {
      write(root, '.claude/CLAUDE.md', '# claude')
      const result: MeasureResult = measure('N63', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('.claude/CLAUDE.md')
    })
  })

  it('missing when neither AGENTS.md nor .claude/CLAUDE.md present', () => {
    withRepo((root: string) => {
      expect(measure('N63', root).status).toBe('missing')
    })
  })
})

// ─── N70 direct .env.example present (early-return branch) ────────────────────

describe('N70 env example', () => {
  it('present via exact .env.example (early existsSync return, no glob)', () => {
    withRepo((root: string) => {
      write(root, '.env.example', 'KEY=value')
      const result: MeasureResult = measure('N70', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('.env.example')
    })
  })
})

// ─── N78 resilience: guide / resilience4j gradle / opossum / missing ─────────

describe('N78 resilience', () => {
  it('present via RESILIENCE.md governance guide (first branch)', () => {
    withRepo((root: string) => {
      write(root, 'docs/GOVERNANCE/RESILIENCE.md', '# resilience')
      const result: MeasureResult = measure('N78', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('docs/GOVERNANCE/RESILIENCE.md')
    })
  })

  it('present via cockatiel dependency', () => {
    withRepo((root: string) => {
      write(root, 'package.json', JSON.stringify({ dependencies: { cockatiel: '^3' } }))
      const result: MeasureResult = measure('N78', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('present via resilience4j in build.gradle (gradle branch of the ternary)', () => {
    withRepo((root: string) => {
      // No pom.xml → pom fileContains false; gradle true → src = build.gradle.
      write(root, 'package.json', '{}')
      write(root, 'build.gradle', 'implementation "io.github.resilience4j:resilience4j-spring-boot2"')
      const result: MeasureResult = measure('N78', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('build.gradle')
    })
  })

  it('present via resilience4j in pom.xml (pom branch of the ternary)', () => {
    withRepo((root: string) => {
      write(root, 'package.json', '{}')
      write(root, 'pom.xml', '<dependency>resilience4j-spring-boot2</dependency>')
      const result: MeasureResult = measure('N78', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('pom.xml')
    })
  })

  it('missing when no resilience signal at all', () => {
    withRepo((root: string) => {
      write(root, 'package.json', '{}')
      const result: MeasureResult = measure('N78', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── measureArchUnit N01: present (dep+test) / partial (dep, no test) / missing ─

describe('N01 archunit dimension (measureArchUnit)', () => {
  it('present when archunit dep and ArchTest class both present', () => {
    withRepo((root: string) => {
      write(root, 'pom.xml', '<dependency>com.tngtech.archunit:archunit</dependency>')
      write(root, 'src/test/java/BoundaryArchTest.java', 'class BoundaryArchTest {}')
      const result: MeasureResult = measure('N01', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('partial when archunit dep present but no ArchTest class', () => {
    withRepo((root: string) => {
      write(root, 'build.gradle', 'testImplementation "com.tngtech.archunit:archunit-junit5"')
      const result: MeasureResult = measure('N01', root)
      expect(result.status).toBe('partial')
      expect(result.evidence).toContain('build.gradle')
    })
  })

  it('missing when no archunit dependency', () => {
    withRepo((root: string) => {
      write(root, 'pom.xml', '<project></project>')
      const result: MeasureResult = measure('N01', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N07 explicit script present (separate from madge-partial fallback) ──────

describe('N07 circular-deps script present', () => {
  it('present via scripts/check-circular-deps.mjs', () => {
    withRepo((root: string) => {
      write(root, 'scripts/check-circular-deps.mjs', '// circular')
      const result: MeasureResult = measure('N07', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('scripts/check-circular-deps.mjs')
    })
  })

  it('missing when neither script nor madge dep', () => {
    withRepo((root: string) => {
      write(root, 'package.json', '{}')
      const result: MeasureResult = measure('N07', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── N20 pitest in build.gradle (ternary false side) ─────────────────────────

describe('N20 pitest gradle branch', () => {
  it('present via pitest in build.gradle (not pom) → src = build.gradle', () => {
    withRepo((root: string) => {
      // No pom.xml → pom fileContains false; gradle true → ternary picks build.gradle.
      write(root, 'package.json', '{}')
      write(root, 'build.gradle', 'id "info.solidsoft.pitest"')
      const result: MeasureResult = measure('N20', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('build.gradle')
    })
  })
})

// ─── N28 spring-cloud-contract in pom.xml (ternary true side) ────────────────

describe('N28 spring-cloud-contract pom branch', () => {
  it('present via spring-cloud-contract in pom.xml → src = pom.xml', () => {
    withRepo((root: string) => {
      write(root, 'package.json', '{}')
      write(root, 'pom.xml', '<dependency>spring-cloud-contract-verifier</dependency>')
      const result: MeasureResult = measure('N28', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('pom.xml')
    })
  })
})

// ─── N29 __tests__/behavioral dir (first checkDir branch) ────────────────────

describe('N29 behavioral dir', () => {
  it('present via __tests__/behavioral dir', () => {
    withRepo((root: string) => {
      write(root, '__tests__/behavioral/login.test.ts', '// bdd')
      const result: MeasureResult = measure('N29', root)
      expect(result.status).toBe('present')
    })
  })
})

// ─── N33 src/__snapshots__ dir (second checkDir branch) ──────────────────────

describe('N33 src snapshots dir', () => {
  it('present via src/__snapshots__ dir (no __tests__ snapshots)', () => {
    withRepo((root: string) => {
      write(root, 'src/__snapshots__/component.snap', 'snap')
      const result: MeasureResult = measure('N33', root)
      expect(result.status).toBe('present')
    })
  })
})

// ─── N38 weekly via cron content (fileContains right side of ||) ──────────────

describe('N38 weekly cron-content match', () => {
  it('present when a non-weekly-named workflow has a sunday cron', () => {
    withRepo((root: string) => {
      // file name "scheduled" is not /weekly/i → falls to fileContains cron check.
      write(
        root,
        '.github/workflows/scheduled.yml',
        'name: scheduled\non:\n  schedule:\n    - cron: "0 6 * * 0"\n',
      )
      const result: MeasureResult = measure('N38', root)
      expect(result.status).toBe('present')
    })
  })
})

// ─── N40 cosign dependency fallback ──────────────────────────────────────────

describe('N40 cosign dep fallback', () => {
  it('present via cosign dependency when no attestation workflow', () => {
    withRepo((root: string) => {
      write(root, 'package.json', JSON.stringify({ devDependencies: { cosign: '^2' } }))
      const result: MeasureResult = measure('N40', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })
})

// ─── N44 keycloak in build.gradle (ternary false side) ───────────────────────

describe('N44 keycloak gradle branch', () => {
  it('present via keycloak in build.gradle (not pom) → src = build.gradle', () => {
    withRepo((root: string) => {
      write(root, 'package.json', '{}')
      write(root, 'build.gradle', 'implementation "org.keycloak:keycloak-spring-boot-starter"')
      const result: MeasureResult = measure('N44', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('build.gradle')
    })
  })
})

// ─── N45 check-format.mjs script file (first checkAny branch) ────────────────

describe('N45 check-format script file', () => {
  it('present via scripts/check-format.mjs', () => {
    withRepo((root: string) => {
      write(root, 'scripts/check-format.mjs', '// fmt')
      const result: MeasureResult = measure('N45', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('scripts/check-format.mjs')
    })
  })
})

// ─── N65 docs/adr lowercase dir (first checkDir branch) ──────────────────────

describe('N65 lowercase adr dir', () => {
  it('present via docs/adr (lowercase) dir', () => {
    withRepo((root: string) => {
      write(root, 'docs/adr/0001-init.md', '# adr')
      const result: MeasureResult = measure('N65', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })
})

// ─── globWorkflows / workflow cache: .yaml extension alternative ──────────────

describe('workflow .yaml extension handling', () => {
  it('N35 present when the PR-triggered workflow uses the .yaml extension', () => {
    withRepo((root: string) => {
      write(root, '.github/workflows/pr.yaml', 'on:\n  pull_request:\n')
      const result: MeasureResult = measure('N35', root)
      expect(result.status).toBe('present')
    })
  })
})

// ─── findRecursive EVIDENCE_CAP: more than 20 matches in one tree ────────────

describe('findRecursive evidence cap', () => {
  it('N08 caps audit-file evidence at the EVIDENCE_CAP ceiling', () => {
    withRepo((root: string) => {
      // 25 audit-named files in one dir → readdir loop hits results.length >= cap break.
      for (let i = 0; i < 25; i++) {
        write(root, `src/AuditEventService${i}.ts`, 'export {}')
      }
      const result: MeasureResult = measure('N08', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeLessThanOrEqual(20)
    })
  })
})

// ─── diagnostic counter stays zero across this whole edge battery ────────────

describe('diagnostic errors remain zero on edge inputs', () => {
  it('no handler throws to the measureDim outer catch on these fixtures', () => {
    withRepo((root: string) => {
      write(root, 'package.json', '{ invalid json')
      mkdir(root, 'build.gradle')
      measure('N14', root)
      measure('N18', root)
      measure('N62', root)
      expect(getMeasureDiagnosticErrors()).toBe(0)
    })
  })
})
