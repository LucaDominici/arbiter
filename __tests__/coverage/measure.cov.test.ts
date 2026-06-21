// SPDX-License-Identifier: Apache-2.0
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const root = mkdtempSync(join(tmpdir(), 'arbiter-cov-measure-'))
  try {
    clearMeasureCache()
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function write(root: string, rel: string, content = ''): void {
  const abs = join(root, rel)
  const lastSlash = abs.lastIndexOf('/')
  if (lastSlash > 0) mkdirSync(abs.slice(0, lastSlash), { recursive: true })
  writeFileSync(abs, content)
}

function measure(id: string, root: string): MeasureResult {
  return measureDim(dim(id), root)
}

beforeEach(() => {
  clearMeasureCache()
})

// ─── measureDim top-level branches ────────────────────────────────────────────

describe('measureDim — top-level branches', () => {
  it('returns missing for unknown dimension id (no handler)', () => {
    withRepo((root) => {
      // N72 has a handler; force a synthetic id with no handler via cast.
      const unknown = makeDim({ id: 'N99' as KitDimension['id'] })
      const result = measureDim(unknown, root)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    })
  })

  it('returns missing when repoRoot does not exist', () => {
    const result = measure('N63', join(tmpdir(), 'arbiter-cov-nonexistent-xyz'))
    expect(result.status).toBe('missing')
    expect(result.evidence).toHaveLength(0)
  })

  it('deduplicates and sorts evidence from a handler', () => {
    withRepo((root) => {
      write(root, 'AGENTS.md', '# Agents')
      write(root, '.claude/CLAUDE.md', '# Claude')
      const result = measure('N63', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toEqual([...result.evidence].sort())
      expect(new Set(result.evidence).size).toBe(result.evidence.length)
    })
  })
})

// ─── diagnostic error counter ─────────────────────────────────────────────────

describe('getMeasureDiagnosticErrors', () => {
  it('starts at zero after clearMeasureCache', () => {
    clearMeasureCache()
    expect(getMeasureDiagnosticErrors()).toBe(0)
  })

  it('stays zero across normal measure calls (no thrown handler)', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      measure('N14', root)
      expect(getMeasureDiagnosticErrors()).toBe(0)
    })
  })
})

// ─── audit_trail N08/N73/N74/N75 ──────────────────────────────────────────────

describe('audit_trail handlers', () => {
  it('N08 present when src has AuditEvent-named file', () => {
    withRepo((root) => {
      write(root, 'src/AuditEventService.ts', 'export {}')
      const result = measure('N08', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N08 missing when no audit file under src', () => {
    withRepo((root) => {
      write(root, 'src/index.ts', 'export {}')
      const result = measure('N08', root)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    })
  })

  it('N73 present when migration file mentions audit', () => {
    withRepo((root) => {
      write(root, 'db/migrations/001_audit_log.sql', 'CREATE TABLE audit;')
      const result = measure('N73', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N73 missing when migration dirs absent', () => {
    withRepo((root) => {
      const result = measure('N73', root)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    })
  })

  it('N74 present when migration contains audit_trigger', () => {
    withRepo((root) => {
      write(root, 'src/main/resources/db/audit_trigger.sql', 'CREATE TRIGGER;')
      const result = measure('N74', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N74 missing when no trigger migration', () => {
    withRepo((root) => {
      write(root, 'db/migrations/001_init.sql', 'CREATE TABLE x;')
      const result = measure('N74', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N75 present when AppendOnly repository found in src', () => {
    withRepo((root) => {
      write(root, 'src/AppendOnlyStore.ts', 'export {}')
      const result = measure('N75', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N75 missing when no append-only repo', () => {
    withRepo((root) => {
      write(root, 'src/index.ts', 'export {}')
      const result = measure('N75', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── static_analysis variants ─────────────────────────────────────────────────

describe('static_analysis handlers', () => {
  it('N10 present when .prettierrc exists', () => {
    withRepo((root) => {
      write(root, '.prettierrc', '{}')
      const result = measure('N10', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('.prettierrc')
    })
  })

  it('N11 present when .semgrep.yml exists', () => {
    withRepo((root) => {
      write(root, '.semgrep.yml', 'rules: []')
      const result = measure('N11', root)
      expect(result.status).toBe('present')
    })
  })

  it('N12 missing when no spotbugs config', () => {
    withRepo((root) => {
      const result = measure('N12', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N13 always missing (placeholder dimension)', () => {
    withRepo((root) => {
      write(root, 'anything.txt', 'x')
      const result = measure('N13', root)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    })
  })

  it('N14 present via knip.json file', () => {
    withRepo((root) => {
      write(root, 'knip.json', '{}')
      const result = measure('N14', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('knip.json')
    })
  })

  it('N14 present via knip devDependency fallback', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ devDependencies: { knip: '^5.0.0' } }))
      const result = measure('N14', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N14 missing when no knip signal', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N14', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N15 present via jscpd dependency fallback', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ dependencies: { jscpd: '^4.0.0' } }))
      const result = measure('N15', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N15 present via .jscpd.json file', () => {
    withRepo((root) => {
      write(root, '.jscpd.json', '{}')
      const result = measure('N15', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('.jscpd.json')
    })
  })

  it('N16 present when design-tokens.json exists', () => {
    withRepo((root) => {
      write(root, 'design-tokens.json', '{}')
      const result = measure('N16', root)
      expect(result.status).toBe('present')
    })
  })
})

// ─── test_framework N18/N19/N20/N21/N23 ──────────────────────────────────────

describe('test_framework handlers', () => {
  it('N18 present via jacoco in build.gradle', () => {
    withRepo((root) => {
      write(root, 'build.gradle', 'apply plugin: "jacoco"')
      const result = measure('N18', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('build.gradle')
    })
  })

  it('N18 missing with no coverage config', () => {
    withRepo((root) => {
      const result = measure('N18', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N19 present when coverage-baseline.json exists', () => {
    withRepo((root) => {
      write(root, 'scripts/coverage-baseline.json', '{}')
      const result = measure('N19', root)
      expect(result.status).toBe('present')
    })
  })

  it('N20 present via stryker.config.js file', () => {
    withRepo((root) => {
      write(root, 'stryker.config.js', 'module.exports = {}')
      const result = measure('N20', root)
      expect(result.status).toBe('present')
    })
  })

  it('N20 present via @stryker-mutator/core dependency', () => {
    withRepo((root) => {
      write(
        root,
        'package.json',
        JSON.stringify({ devDependencies: { '@stryker-mutator/core': '^8.0.0' } }),
      )
      const result = measure('N20', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N20 present via pitest in pom.xml', () => {
    withRepo((root) => {
      write(root, 'pom.xml', '<plugin>pitest-maven</plugin>')
      const result = measure('N20', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('pom.xml')
    })
  })

  it('N20 missing when no mutation tooling', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N20', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N21 present when vitest config has poolOptions', () => {
    withRepo((root) => {
      write(root, 'vitest.config.ts', 'export default { test: { poolOptions: {} } }')
      const result = measure('N21', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('vitest.config.ts')
    })
  })

  it('N21 missing when no pool config', () => {
    withRepo((root) => {
      const result = measure('N21', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N23 present when .arbiter/evidence/tdd has files', () => {
    withRepo((root) => {
      write(root, '.arbiter/evidence/tdd/1234.json', '{}')
      const result = measure('N23', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N23 missing when tdd evidence dir absent', () => {
    withRepo((root) => {
      const result = measure('N23', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── test_types N28/N29/N31/N32/N33 ──────────────────────────────────────────

describe('test_types handlers', () => {
  it('N28 present via __tests__/contract dir', () => {
    withRepo((root) => {
      write(root, '__tests__/contract/foo.test.ts', '// contract')
      const result = measure('N28', root)
      expect(result.status).toBe('present')
    })
  })

  it('N28 present via @pact-foundation/pact dependency', () => {
    withRepo((root) => {
      write(
        root,
        'package.json',
        JSON.stringify({ devDependencies: { '@pact-foundation/pact': '^12.0.0' } }),
      )
      const result = measure('N28', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N28 present via spring-cloud-contract in build.gradle', () => {
    withRepo((root) => {
      write(root, 'build.gradle', 'spring-cloud-contract-verifier')
      const result = measure('N28', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('build.gradle')
    })
  })

  it('N28 missing when no contract signals', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N28', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N29 present via features dir', () => {
    withRepo((root) => {
      write(root, 'features/login.feature', 'Feature: login')
      const result = measure('N29', root)
      expect(result.status).toBe('present')
    })
  })

  it('N29 present via @cucumber/cucumber dependency', () => {
    withRepo((root) => {
      write(
        root,
        'package.json',
        JSON.stringify({ devDependencies: { '@cucumber/cucumber': '^10.0.0' } }),
      )
      const result = measure('N29', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N29 missing when no behavioral signals', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N29', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N31 present via fuzz dir', () => {
    withRepo((root) => {
      write(root, 'fuzz/target.rs', 'fn main() {}')
      const result = measure('N31', root)
      expect(result.status).toBe('present')
    })
  })

  it('N31 present via FuzzTest java class', () => {
    withRepo((root) => {
      write(root, 'src/test/java/MyFuzzTest.java', 'class MyFuzzTest {}')
      const result = measure('N31', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N31 missing when no fuzz signals', () => {
    withRepo((root) => {
      const result = measure('N31', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N32 present via fast-check dependency', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ devDependencies: { 'fast-check': '^3.0.0' } }))
      const result = measure('N32', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N32 missing when no property testing dep', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N32', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N33 present via __tests__/__snapshots__ dir', () => {
    withRepo((root) => {
      write(root, '__tests__/__snapshots__/a.snap', 'snapshot')
      const result = measure('N33', root)
      expect(result.status).toBe('present')
    })
  })

  it('N33 present via check-api-snapshot.mjs fallback', () => {
    withRepo((root) => {
      write(root, 'scripts/check-api-snapshot.mjs', '// snapshot')
      const result = measure('N33', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('scripts/check-api-snapshot.mjs')
    })
  })

  it('N33 missing when no snapshot signals', () => {
    withRepo((root) => {
      const result = measure('N33', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── cicd N36/N37/N38/N40 ─────────────────────────────────────────────────────

describe('cicd handlers', () => {
  it('N36 present via release tag workflow', () => {
    withRepo((root) => {
      write(
        root,
        '.github/workflows/release.yml',
        'name: release\non:\n  push:\n    tags: ["v*"]\n',
      )
      const result = measure('N36', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N36 missing when no tag/release workflow', () => {
    withRepo((root) => {
      write(root, '.github/workflows/ci.yml', 'name: ci\non:\n  push:\n')
      const result = measure('N36', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N37 present via nightly-named scheduled workflow', () => {
    withRepo((root) => {
      write(
        root,
        '.github/workflows/nightly.yml',
        'name: nightly\non:\n  schedule:\n    - cron: "0 3 * * *"\n',
      )
      const result = measure('N37', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N37 missing when scheduled workflow is not nightly', () => {
    withRepo((root) => {
      write(
        root,
        '.github/workflows/weekly.yml',
        'name: weekly\non:\n  schedule:\n    - cron: "0 9 * * 0"\n',
      )
      const result = measure('N37', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N38 present via weekly-named scheduled workflow', () => {
    withRepo((root) => {
      write(
        root,
        '.github/workflows/weekly.yml',
        'name: weekly\non:\n  schedule:\n    - cron: "0 9 * * 0"\n',
      )
      const result = measure('N38', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N38 missing when no weekly schedule', () => {
    withRepo((root) => {
      write(root, '.github/workflows/ci.yml', 'name: ci\non:\n  push:\n')
      const result = measure('N38', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N40 present via attest-build-provenance in workflow', () => {
    withRepo((root) => {
      write(
        root,
        '.github/workflows/release.yml',
        'name: release\nsteps:\n  - uses: actions/attest-build-provenance@v1\n',
      )
      const result = measure('N40', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N40 missing when no signing/attestation', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N40', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── e2e_perf N42/N43/N44 ─────────────────────────────────────────────────────

describe('e2e_perf handlers', () => {
  it('N42 present when locustfile.py exists', () => {
    withRepo((root) => {
      write(root, 'locustfile.py', '# locust')
      const result = measure('N42', root)
      expect(result.status).toBe('present')
    })
  })

  it('N43 present when zap workflow exists', () => {
    withRepo((root) => {
      write(root, '.github/workflows/dast.yml', 'name: dast\nsteps:\n  - uses: zaproxy/zap-scan\n')
      const result = measure('N43', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N43 missing when no DAST workflow', () => {
    withRepo((root) => {
      write(root, '.github/workflows/ci.yml', 'name: ci\n')
      const result = measure('N43', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N44 present via keycloak-js dependency', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ dependencies: { 'keycloak-js': '^24.0.0' } }))
      const result = measure('N44', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N44 present via keycloak test file', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      write(root, '__tests__/keycloak.test.ts', '// keycloak')
      const result = measure('N44', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N44 present via keycloak in pom.xml', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      write(root, 'pom.xml', '<dependency>keycloak-spring-boot-starter</dependency>')
      const result = measure('N44', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('pom.xml')
    })
  })

  it('N44 missing when no keycloak signals', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N44', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── scripts_validation/quality N45/N51/N52/N54 ──────────────────────────────

describe('scripts handlers', () => {
  it('N45 present via package.json format script (no check-format file)', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ scripts: { fmt: 'cargo fmt' } }))
      const result = measure('N45', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N45 missing when no format tooling', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N45', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N51 present when debt-baseline.json exists', () => {
    withRepo((root) => {
      write(root, 'debt-baseline.json', '{}')
      const result = measure('N51', root)
      expect(result.status).toBe('present')
    })
  })

  it('N52 present when check-self-dogfood.mjs exists', () => {
    withRepo((root) => {
      write(root, 'scripts/check-self-dogfood.mjs', '// dogfood')
      const result = measure('N52', root)
      expect(result.status).toBe('present')
    })
  })

  it('N54 present via check-circular-deps.mjs', () => {
    withRepo((root) => {
      write(root, 'scripts/check-circular-deps.mjs', '// circular')
      const result = measure('N54', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('scripts/check-circular-deps.mjs')
    })
  })

  it('N54 present via madge dependency fallback', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ devDependencies: { madge: '^7.0.0' } }))
      const result = measure('N54', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N54 missing when no circular-dep tooling', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N54', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N07 partial via madge dep but no script', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ devDependencies: { madge: '^7.0.0' } }))
      const result = measure('N07', root)
      expect(result.status).toBe('partial')
      expect(result.evidence).toContain('package.json')
    })
  })
})

// ─── security N57/N58 ─────────────────────────────────────────────────────────

describe('security handlers', () => {
  it('N57 present via .trivyignore file', () => {
    withRepo((root) => {
      write(root, '.trivyignore', '# ignore')
      const result = measure('N57', root)
      expect(result.status).toBe('present')
    })
  })

  it('N57 present via trivy workflow', () => {
    withRepo((root) => {
      write(
        root,
        '.github/workflows/scan.yml',
        'name: scan\nsteps:\n  - uses: aquasecurity/trivy-action\n',
      )
      const result = measure('N57', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N57 missing when no container scan', () => {
    withRepo((root) => {
      const result = measure('N57', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N58 present via .fossa.yml file', () => {
    withRepo((root) => {
      write(root, '.fossa.yml', 'version: 3')
      const result = measure('N58', root)
      expect(result.status).toBe('present')
    })
  })

  it('N58 present via licensee dependency', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ devDependencies: { licensee: '^10.0.0' } }))
      const result = measure('N58', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N58 missing when no license scan tooling', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N58', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── git_github N60 ──────────────────────────────────────────────────────────

describe('git_github handlers', () => {
  it('N60 present via check-branch-name.mjs', () => {
    withRepo((root) => {
      write(root, 'scripts/check-branch-name.mjs', '// branch')
      const result = measure('N60', root)
      expect(result.status).toBe('present')
    })
  })

  it('N60 partial via AGENTS.md branch convention mention', () => {
    withRepo((root) => {
      write(root, 'AGENTS.md', 'Branch convention: task/#NNN-slug')
      const result = measure('N60', root)
      expect(result.status).toBe('partial')
      expect(result.evidence).toContain('AGENTS.md')
    })
  })

  it('N60 missing when no branch-name signal', () => {
    withRepo((root) => {
      const result = measure('N60', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── documentation N64/N65/N66/N67/N68 ───────────────────────────────────────

describe('documentation handlers', () => {
  it('N64 present when ci-developer-reference.md exists', () => {
    withRepo((root) => {
      write(root, 'docs/ci-reference.md', '# CI reference')
      const result = measure('N64', root)
      expect(result.status).toBe('present')
    })
  })

  it('N65 present via docs/ADR (uppercase) dir', () => {
    withRepo((root) => {
      write(root, 'docs/ADR/001-x.md', '# adr')
      const result = measure('N65', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N65 present via DECISIONS.md fallback', () => {
    withRepo((root) => {
      write(root, 'docs/SYSTEM/DECISIONS.md', '# decisions')
      const result = measure('N65', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('docs/SYSTEM/DECISIONS.md')
    })
  })

  it('N66 present when openapi.yaml exists', () => {
    withRepo((root) => {
      write(root, 'openapi.yaml', 'openapi: 3.0.0')
      const result = measure('N66', root)
      expect(result.status).toBe('present')
    })
  })

  it('N67 present via docs/runbooks dir', () => {
    withRepo((root) => {
      write(root, 'docs/runbooks/deploy.md', '# runbook')
      const result = measure('N67', root)
      expect(result.status).toBe('present')
    })
  })

  it('N67 present via RUNBOOK.md fallback', () => {
    withRepo((root) => {
      write(root, 'RUNBOOK.md', '# runbook')
      const result = measure('N67', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('RUNBOOK.md')
    })
  })

  it('N68 present via check-knowledge-map.mjs', () => {
    withRepo((root) => {
      write(root, 'scripts/check-knowledge-map.mjs', '// km')
      const result = measure('N68', root)
      expect(result.status).toBe('present')
    })
  })
})

// ─── configuration N71/N72 ───────────────────────────────────────────────────

describe('configuration handlers', () => {
  it('N70 present via .env.local.example glob match', () => {
    withRepo((root) => {
      write(root, '.env.local.example', 'KEY=')
      const result = measure('N70', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })

  it('N70 missing when no env example present', () => {
    withRepo((root) => {
      write(root, 'README.md', '# x')
      const result = measure('N70', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N71 present when feature-flags.ts exists', () => {
    withRepo((root) => {
      write(root, 'src/feature-flags.ts', 'export {}')
      const result = measure('N71', root)
      expect(result.status).toBe('present')
    })
  })

  it('N72 present when config/dev exists', () => {
    withRepo((root) => {
      write(root, 'config/dev/app.yml', 'x: 1')
      const result = measure('N72', root)
      expect(result.status).toBe('present')
    })
  })

  it('N72 missing when no staging config', () => {
    withRepo((root) => {
      const result = measure('N72', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── a11y N76 ─────────────────────────────────────────────────────────────────

describe('a11y handler', () => {
  it('N76 present via lighthouserc fallback (no axe dep)', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      write(root, '.lighthouserc.json', '{}')
      const result = measure('N76', root)
      expect(result.status).toBe('present')
    })
  })

  it('N76 present via pa11y dependency', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ devDependencies: { pa11y: '^8.0.0' } }))
      const result = measure('N76', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })

  it('N76 missing when no a11y tooling', () => {
    withRepo((root) => {
      write(root, 'package.json', '{}')
      const result = measure('N76', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── module_boundaries N77 ────────────────────────────────────────────────────

describe('module_boundaries N77', () => {
  it('present (verify file) when spring-modulith + ApplicationModules test', () => {
    withRepo((root) => {
      write(root, 'pom.xml', '<dependency>spring-modulith-core</dependency>')
      write(
        root,
        'src/test/java/ModularityTest.java',
        'class ModularityTest { ApplicationModules m; }',
      )
      const result = measure('N77', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('present (dep only) when spring-modulith but no verify test', () => {
    withRepo((root) => {
      write(root, 'build.gradle', 'implementation "org.springframework.modulith:spring-modulith"')
      const result = measure('N77', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('build.gradle')
    })
  })

  it('missing when no spring-modulith dep', () => {
    withRepo((root) => {
      write(root, 'pom.xml', '<project></project>')
      const result = measure('N77', root)
      expect(result.status).toBe('missing')
    })
  })
})

// ─── resilience N78 tenacity branch ──────────────────────────────────────────

describe('resilience N78 tenacity branch', () => {
  it('present when requirements.txt mentions tenacity', () => {
    withRepo((root) => {
      write(root, 'requirements.txt', 'tenacity==8.2.0\n')
      const result = measure('N78', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('requirements.txt')
    })
  })

  it('present via opossum dependency', () => {
    withRepo((root) => {
      write(root, 'package.json', JSON.stringify({ dependencies: { opossum: '^8.0.0' } }))
      const result = measure('N78', root)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('package.json')
    })
  })
})

// ─── filesystem-edge: large file skip in fileContains (N18 path) ─────────────

describe('fileContains large-file guard', () => {
  it('N18 missing when vitest config is >1MB (large file skipped)', () => {
    withRepo((root) => {
      // build a >1MB vitest.config.ts that DOES contain "thresholds"
      const big = 'thresholds\n' + 'x'.repeat(1_100_000)
      write(root, 'vitest.config.ts', big)
      const result = measure('N18', root)
      // large file is skipped by fileContains → no threshold match → missing
      expect(result.status).toBe('missing')
    })
  })
})

// ─── findRecursive: SKIP_DIRS + depth + cache reuse ──────────────────────────

describe('findRecursive traversal', () => {
  it('N08 skips node_modules when locating audit files', () => {
    withRepo((root) => {
      // audit-named file ONLY inside node_modules → must be skipped → missing
      write(root, 'src/node_modules/AuditEventService.ts', 'export {}')
      const result = measure('N08', root)
      expect(result.status).toBe('missing')
    })
  })

  it('N08 finds audit file nested several directories deep', () => {
    withRepo((root) => {
      write(root, 'src/a/b/c/d/AuditEventService.ts', 'export {}')
      const result = measure('N08', root)
      expect(result.status).toBe('present')
      expect(result.evidence.length).toBeGreaterThan(0)
    })
  })
})

// ─── workflow cache reuse across calls (same repoRoot, two dims) ─────────────

describe('workflow cache reuse', () => {
  it('serves two workflow-reading dims from the same cached repo map', () => {
    withRepo((root) => {
      write(
        root,
        '.github/workflows/ci.yml',
        'name: ci\non:\n  pull_request:\n  schedule:\n    - cron: "0 2 * * *"\n',
      )
      // First read populates cache; second read (different pattern) reuses it.
      const pr = measure('N35', root)
      const sched = measure('N26', root)
      expect(pr.status).toBe('present')
      expect(sched.status).toBe('present')
    })
  })
})
