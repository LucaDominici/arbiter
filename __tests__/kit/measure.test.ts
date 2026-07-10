// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { measureDim, clearMeasureCache, type MeasureResult } from '../../src/kit/measure.js'
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

// ─── Fixture repo ─────────────────────────────────────────────────────────────

let fixtureRoot: string

beforeAll(() => {
  fixtureRoot = join(tmpdir(), `arbiter-measure-test-${process.pid}`)
  mkdirSync(fixtureRoot, { recursive: true })

  // Directories
  mkdirSync(join(fixtureRoot, '.github/workflows'), { recursive: true })
  mkdirSync(join(fixtureRoot, '.github/ISSUE_TEMPLATE'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'src/test/java/com/example'), { recursive: true })
  mkdirSync(join(fixtureRoot, '__tests__/integration'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'docs/adr'), { recursive: true })

  // Workflow files — N34: ≥2 workflows; N35: pull_request trigger
  writeFileSync(
    join(fixtureRoot, '.github/workflows/01-gate.yml'),
    'name: gate\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n',
  )
  writeFileSync(
    join(fixtureRoot, '.github/workflows/02-nightly.yml'),
    'name: nightly\non:\n  schedule:\n    - cron: "0 2 * * *"\n',
  )

  // package.json with test scripts and deps
  writeFileSync(
    join(fixtureRoot, 'package.json'),
    JSON.stringify({
      name: 'test-project',
      scripts: {
        'test:unit': 'vitest run --project unit',
        'test:integration': 'vitest run --project integration',
        format: 'prettier --write .',
      },
      dependencies: {},
      devDependencies: {
        'axe-core': '^4.9.0',
      },
    }),
  )

  // CI/CD runner label workflow
  writeFileSync(
    join(fixtureRoot, '.github/workflows/03-ci.yml'),
    'name: ci\non:\n  push:\n    tags: ["v*"]\nruns-on: ${{ vars.CI_BUILD_RUNNER_LABEL }}\n',
  )

  // Static analysis
  writeFileSync(join(fixtureRoot, '.eslintrc.json'), '{"rules":{}}')

  // Test framework
  writeFileSync(
    join(fixtureRoot, 'vitest.config.ts'),
    "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { coverage: { thresholds: { lines: 80 } }, exclude: ['dist/**'] } })\n",
  )
  writeFileSync(join(fixtureRoot, 'scripts/check-test-naming.mjs'), '// check test naming')

  // Architecture
  writeFileSync(join(fixtureRoot, 'scripts/check-circular-deps.mjs'), '// check circular deps')
  writeFileSync(
    join(fixtureRoot, 'pom.xml'),
    '<project><dependencies><dependency><groupId>com.tngtech.archunit</groupId><artifactId>archunit-junit5</artifactId></dependency></dependencies></project>',
  )
  writeFileSync(
    join(fixtureRoot, 'src/test/java/com/example/ArchTestExample.java'),
    'class ArchTestExample {}',
  )

  // Integration tests
  writeFileSync(join(fixtureRoot, '__tests__/integration/api.test.ts'), '// api integration tests')

  // e2e
  writeFileSync(join(fixtureRoot, 'playwright.config.ts'), 'export default {}')

  // scripts_validation
  writeFileSync(join(fixtureRoot, 'scripts/check-spdx-headers.mjs'), '// spdx')
  writeFileSync(join(fixtureRoot, 'scripts/check-no-orphan-todo.mjs'), '// orphan todo')
  writeFileSync(join(fixtureRoot, 'scripts/check-no-placeholders.mjs'), '// placeholders')
  writeFileSync(join(fixtureRoot, 'scripts/check-doc-links.mjs'), '// doc links')
  writeFileSync(join(fixtureRoot, 'scripts/check-bloat-ratchet.mjs'), '// bloat ratchet')
  writeFileSync(join(fixtureRoot, 'scripts/check-format.mjs'), '// format')

  // scripts_quality
  writeFileSync(join(fixtureRoot, 'scripts/check-api-snapshot.mjs'), '// api snapshot')

  // security
  writeFileSync(join(fixtureRoot, '.gitleaks.toml'), '[allowlist]')
  writeFileSync(join(fixtureRoot, 'owasp-suppressions.xml'), '<suppressions/>')

  // git_github
  writeFileSync(
    join(fixtureRoot, 'commitlint.config.js'),
    "module.exports = { extends: ['@commitlint/config-conventional'] }",
  )
  writeFileSync(join(fixtureRoot, '.github/pull_request_template.md'), '## Summary')
  writeFileSync(join(fixtureRoot, '.github/ISSUE_TEMPLATE/bug.md'), '# Bug report')

  // documentation
  writeFileSync(join(fixtureRoot, 'AGENTS.md'), '# Agents')
  writeFileSync(join(fixtureRoot, 'docs/adr/001-init.md'), '# ADR 001')

  // configuration
  writeFileSync(join(fixtureRoot, '.nvmrc'), '22')
  writeFileSync(join(fixtureRoot, '.env.example'), 'DATABASE_URL=')

  // module_boundaries
  writeFileSync(
    join(fixtureRoot, 'pom.xml'),
    '<project><dependencies>' +
      '<dependency><groupId>com.tngtech.archunit</groupId><artifactId>archunit-junit5</artifactId></dependency>' +
      '<dependency><groupId>org.springframework.modulith</groupId><artifactId>spring-modulith-core</artifactId></dependency>' +
      '</dependencies></project>',
  )
})

beforeEach(() => {
  clearMeasureCache()
})

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

// ─── Return type ──────────────────────────────────────────────────────────────

describe('measureDim — return type', () => {
  it('returns MeasureResult with status and evidence', () => {
    const result: MeasureResult = measureDim(makeDim(), fixtureRoot)
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('evidence')
    expect(Array.isArray(result.evidence)).toBe(true)
  })

  it('status is one of present|partial|missing', () => {
    const result = measureDim(makeDim(), fixtureRoot)
    expect(['present', 'partial', 'missing']).toContain(result.status)
  })
})

// ─── Evidence determinism ─────────────────────────────────────────────────────

describe('measureDim — evidence determinism', () => {
  it('produces lexicographically sorted evidence paths', () => {
    const result = measureDim(dim('N63'), fixtureRoot)
    const sorted = [...result.evidence].sort()
    expect(result.evidence).toEqual(sorted)
  })

  it('produces identical output on repeated calls', () => {
    const r1 = measureDim(dim('N63'), fixtureRoot)
    clearMeasureCache()
    const r2 = measureDim(dim('N63'), fixtureRoot)
    expect(r1.status).toBe(r2.status)
    expect(r1.evidence).toEqual(r2.evidence)
  })

  it('evidence paths use forward slashes (POSIX-relative)', () => {
    const result = measureDim(dim('N63'), fixtureRoot)
    for (const e of result.evidence) {
      expect(e).not.toMatch(/^\//)
      expect(e).not.toContain('\\')
    }
  })

  it('evidence paths have no duplicates', () => {
    const result = measureDim(dim('N63'), fixtureRoot)
    const unique = new Set(result.evidence)
    expect(result.evidence.length).toBe(unique.size)
  })
})

// ─── Empty repo (everything missing) ─────────────────────────────────────────

describe('measureDim — empty repo', () => {
  let emptyRoot: string

  beforeAll(() => {
    emptyRoot = join(tmpdir(), `arbiter-measure-empty-${process.pid}`)
    mkdirSync(emptyRoot, { recursive: true })
    writeFileSync(join(emptyRoot, 'package.json'), '{}')
  })

  afterAll(() => {
    rmSync(emptyRoot, { recursive: true, force: true })
  })

  it('returns missing for N34 (cicd) in repo with no workflows', () => {
    const result = measureDim(dim('N34', 'cicd'), emptyRoot)
    expect(result.status).toBe('missing')
    expect(result.evidence).toHaveLength(0)
  })
})

// ─── Non-existent repoRoot ────────────────────────────────────────────────────

describe('measureDim — missing repoRoot', () => {
  it('returns missing without throwing', () => {
    const result = measureDim(makeDim(), '/tmp/does-not-exist-arbiter-test')
    expect(result.status).toBe('missing')
    expect(result.evidence).toHaveLength(0)
  })
})

// ─── Invariants ───────────────────────────────────────────────────────────────

describe('measureDim — invariants', () => {
  it('missing status always has empty evidence', () => {
    const result = measureDim(dim('N34', 'cicd'), join(tmpdir(), 'nonexistent-arbiter-inv'))
    if (result.status === 'missing') {
      expect(result.evidence).toHaveLength(0)
    }
  })

  it('present or partial always has non-empty evidence', () => {
    const result = measureDim(dim('N34', 'cicd'), fixtureRoot)
    if (result.status === 'present' || result.status === 'partial') {
      expect(result.evidence.length).toBeGreaterThan(0)
    }
  })
})

// ─── cicd — N34/N35 (fixes fabricated N20 regression) ───────────────────────

describe('cicd — N34: ≥2 workflow files', () => {
  it('returns present when ≥2 workflow files exist', () => {
    const result = measureDim(dim('N34', 'cicd'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(2)
  })

  it('returns missing with empty evidence when only 1 workflow file exists', () => {
    const oneWfRoot = join(tmpdir(), `arbiter-n34-one-${process.pid}`)
    mkdirSync(join(oneWfRoot, '.github/workflows'), { recursive: true })
    writeFileSync(join(oneWfRoot, '.github/workflows/ci.yml'), 'name: ci\non:\n  push:\n')
    try {
      clearMeasureCache()
      const result = measureDim(dim('N34', 'cicd'), oneWfRoot)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    } finally {
      rmSync(oneWfRoot, { recursive: true, force: true })
    }
  })
})

describe('cicd — N35: pull_request trigger', () => {
  it('returns present when a workflow contains pull_request trigger', () => {
    const result = measureDim(dim('N35', 'cicd'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── architecture — compound ──────────────────────────────────────────────────

describe('architecture — N07: circular deps (compound)', () => {
  it('returns present when scripts/check-circular-deps.mjs exists', () => {
    const result = measureDim(dim('N07', 'architecture'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('scripts/check-circular-deps.mjs')
  })

  it('returns missing when neither script nor dep exists', () => {
    const emptyRoot = join(tmpdir(), `arbiter-n07-empty-${process.pid}`)
    mkdirSync(emptyRoot, { recursive: true })
    writeFileSync(join(emptyRoot, 'package.json'), '{}')
    try {
      clearMeasureCache()
      const result = measureDim(dim('N07', 'architecture'), emptyRoot)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })
})

describe('architecture — N01-N06: ArchUnit (compound)', () => {
  it('returns present when pom.xml has ArchUnit dep AND ArchTest class found', () => {
    // fixtureRoot has both pom.xml with archunit dep and ArchTestExample.java
    const result = measureDim(dim('N01', 'architecture'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })

  it('returns partial when pom.xml has ArchUnit dep but no ArchTest class', () => {
    const partialRoot = join(tmpdir(), `arbiter-n01-partial-${process.pid}`)
    mkdirSync(partialRoot, { recursive: true })
    writeFileSync(
      join(partialRoot, 'pom.xml'),
      '<project><dependencies><dependency><groupId>com.tngtech.archunit</groupId><artifactId>archunit-junit5</artifactId></dependency></dependencies></project>',
    )
    try {
      clearMeasureCache()
      const result = measureDim(dim('N01', 'architecture'), partialRoot)
      expect(result.status).toBe('partial')
      expect(result.evidence.length).toBeGreaterThan(0)
    } finally {
      rmSync(partialRoot, { recursive: true, force: true })
    }
  })

  it('returns missing when no ArchUnit dep present', () => {
    const emptyRoot = join(tmpdir(), `arbiter-n01-empty-${process.pid}`)
    mkdirSync(emptyRoot, { recursive: true })
    writeFileSync(join(emptyRoot, 'package.json'), '{}')
    try {
      clearMeasureCache()
      const result = measureDim(dim('N01', 'architecture'), emptyRoot)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })
})

// ─── static_analysis — N09 ───────────────────────────────────────────────────

describe('static_analysis — N09: linter config', () => {
  it('returns present when .eslintrc.json exists', () => {
    const result = measureDim(dim('N09', 'static_analysis'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })

  it('returns missing when no linter config exists', () => {
    const emptyRoot = join(tmpdir(), `arbiter-n09-empty-${process.pid}`)
    mkdirSync(emptyRoot, { recursive: true })
    try {
      clearMeasureCache()
      const result = measureDim(dim('N09', 'static_analysis'), emptyRoot)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })
})

// ─── test_framework — compound ────────────────────────────────────────────────

describe('test_framework — N17: test runner config', () => {
  it('returns present when vitest.config.ts exists', () => {
    const result = measureDim(dim('N17', 'test_framework'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })
})

describe('test_framework — N18: coverage thresholds (compound)', () => {
  it('returns present when vitest.config.ts contains coverage thresholds', () => {
    // fixtureRoot vitest.config.ts has `thresholds: { lines: 80 }`
    const result = measureDim(dim('N18', 'test_framework'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })

  it('returns missing when config exists but lacks threshold content', () => {
    const noThreshRoot = join(tmpdir(), `arbiter-n18-nothresh-${process.pid}`)
    mkdirSync(noThreshRoot, { recursive: true })
    writeFileSync(
      join(noThreshRoot, 'vitest.config.ts'),
      "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: {} })\n",
    )
    try {
      clearMeasureCache()
      const result = measureDim(dim('N18', 'test_framework'), noThreshRoot)
      expect(result.status).toBe('missing')
    } finally {
      rmSync(noThreshRoot, { recursive: true, force: true })
    }
  })
})

describe('test_framework — N22: test naming check', () => {
  it('returns present when scripts/check-test-naming.mjs exists', () => {
    const result = measureDim(dim('N22', 'test_framework'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('scripts/check-test-naming.mjs')
  })
})

// ─── test_profiles — compound ─────────────────────────────────────────────────

describe('test_profiles — N24: unit test profile (compound)', () => {
  it('returns present when test:unit script in package.json', () => {
    // fixtureRoot package.json has test:unit script
    const result = measureDim(dim('N24', 'test_profiles'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })

  it('returns partial when vitest.config has exclude but no test:unit script', () => {
    const partialRoot = join(tmpdir(), `arbiter-n24-partial-${process.pid}`)
    mkdirSync(partialRoot, { recursive: true })
    writeFileSync(
      join(partialRoot, 'package.json'),
      JSON.stringify({ name: 'x', scripts: {}, devDependencies: {} }),
    )
    writeFileSync(
      join(partialRoot, 'vitest.config.ts'),
      "export default { test: { exclude: ['dist/**'] } }",
    )
    try {
      clearMeasureCache()
      const result = measureDim(dim('N24', 'test_profiles'), partialRoot)
      expect(result.status).toBe('partial')
      expect(result.evidence.length).toBeGreaterThan(0)
    } finally {
      rmSync(partialRoot, { recursive: true, force: true })
    }
  })

  it('returns missing when no unit test profile indicators', () => {
    const emptyRoot = join(tmpdir(), `arbiter-n24-empty-${process.pid}`)
    mkdirSync(emptyRoot, { recursive: true })
    writeFileSync(join(emptyRoot, 'package.json'), '{}')
    try {
      clearMeasureCache()
      const result = measureDim(dim('N24', 'test_profiles'), emptyRoot)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })
})

describe('test_profiles — N25: integration test profile (compound)', () => {
  it('returns present when test:integration script in package.json', () => {
    // fixtureRoot package.json has test:integration script
    const result = measureDim(dim('N25', 'test_profiles'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })

  it('returns partial when workflow mentions integration but no script', () => {
    const partialRoot = join(tmpdir(), `arbiter-n25-partial-${process.pid}`)
    mkdirSync(join(partialRoot, '.github/workflows'), { recursive: true })
    writeFileSync(join(partialRoot, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }))
    writeFileSync(
      join(partialRoot, '.github/workflows/integration.yml'),
      'name: integration tests\non:\n  push:\n',
    )
    try {
      clearMeasureCache()
      const result = measureDim(dim('N25', 'test_profiles'), partialRoot)
      expect(result.status).toBe('partial')
      expect(result.evidence.length).toBeGreaterThan(0)
    } finally {
      rmSync(partialRoot, { recursive: true, force: true })
    }
  })
})

describe('test_profiles — N26: scheduled workflow', () => {
  it('returns present when workflow contains schedule trigger', () => {
    // fixtureRoot has 02-nightly.yml with schedule cron
    const result = measureDim(dim('N26', 'test_profiles'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── test_types ───────────────────────────────────────────────────────────────

describe('test_types — N27: integration test files', () => {
  it('returns present when __tests__/integration/ has files', () => {
    const result = measureDim(dim('N27', 'test_types'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── e2e_perf ─────────────────────────────────────────────────────────────────

describe('e2e_perf — N41: E2E config', () => {
  it('returns present when playwright.config.ts exists', () => {
    const result = measureDim(dim('N41', 'e2e_perf'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── scripts_validation ───────────────────────────────────────────────────────

describe('scripts_validation — N45-N50', () => {
  const cases: [string, string][] = [
    ['N45', 'scripts/check-format.mjs'],
    ['N46', 'scripts/check-spdx-headers.mjs'],
    ['N47', 'scripts/check-no-orphan-todo.mjs'],
    ['N48', 'scripts/check-no-placeholders.mjs'],
    ['N49', 'scripts/check-doc-links.mjs'],
    ['N50', 'scripts/check-bloat-ratchet.mjs'],
  ]

  for (const [id, expectedEvidence] of cases) {
    it(`${id} returns present when ${expectedEvidence} exists`, () => {
      const result = measureDim(dim(id, 'scripts_validation'), fixtureRoot)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain(expectedEvidence)
    })

    it(`${id} returns missing when script absent`, () => {
      const emptyRoot = join(tmpdir(), `arbiter-${id}-empty-${process.pid}`)
      mkdirSync(emptyRoot, { recursive: true })
      writeFileSync(join(emptyRoot, 'package.json'), '{}')
      try {
        clearMeasureCache()
        const result = measureDim(dim(id, 'scripts_validation'), emptyRoot)
        expect(result.status).toBe('missing')
        expect(result.evidence).toHaveLength(0)
      } finally {
        rmSync(emptyRoot, { recursive: true, force: true })
      }
    })
  }
})

// ─── scripts_quality ──────────────────────────────────────────────────────────

describe('scripts_quality — N53: API snapshot', () => {
  it('returns present when scripts/check-api-snapshot.mjs exists', () => {
    const result = measureDim(dim('N53', 'scripts_quality'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('scripts/check-api-snapshot.mjs')
  })
})

// ─── security — compound ─────────────────────────────────────────────────────

describe('security — N55: gitleaks (compound)', () => {
  it('returns present when .gitleaks.toml exists', () => {
    const result = measureDim(dim('N55', 'security'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('.gitleaks.toml')
  })

  it('returns partial when gitleaks only in workflow (no config file)', () => {
    const wfRoot = join(tmpdir(), `arbiter-n55-wf-${process.pid}`)
    mkdirSync(join(wfRoot, '.github/workflows'), { recursive: true })
    writeFileSync(join(wfRoot, 'package.json'), '{}')
    writeFileSync(
      join(wfRoot, '.github/workflows/security.yml'),
      'name: security\nsteps:\n  - uses: gitleaks/gitleaks-action@v2\n',
    )
    try {
      clearMeasureCache()
      const result = measureDim(dim('N55', 'security'), wfRoot)
      expect(result.status).toBe('partial')
      expect(result.evidence.length).toBeGreaterThan(0)
    } finally {
      rmSync(wfRoot, { recursive: true, force: true })
    }
  })

  it('returns missing when neither config nor workflow gitleaks reference', () => {
    const emptyRoot = join(tmpdir(), `arbiter-n55-empty-${process.pid}`)
    mkdirSync(emptyRoot, { recursive: true })
    writeFileSync(join(emptyRoot, 'package.json'), '{}')
    try {
      clearMeasureCache()
      const result = measureDim(dim('N55', 'security'), emptyRoot)
      expect(result.status).toBe('missing')
      expect(result.evidence).toHaveLength(0)
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })
})

describe('security — N56: dependency audit (compound)', () => {
  it('returns present when owasp-suppressions.xml exists (legacy)', () => {
    const result = measureDim(dim('N56', 'security'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('owasp-suppressions.xml')
  })

  it('returns present when .trivyignore exists (post-OWASP DC→trivy swap)', () => {
    const wfRoot = join(tmpdir(), `arbiter-n56-trivy-${process.pid}`)
    mkdirSync(wfRoot, { recursive: true })
    writeFileSync(join(wfRoot, '.trivyignore'), '# empty\n')
    try {
      clearMeasureCache()
      const result = measureDim(dim('N56', 'security'), wfRoot)
      expect(result.status).toBe('present')
      expect(result.evidence).toContain('.trivyignore')
    } finally {
      rmSync(wfRoot, { recursive: true, force: true })
    }
  })

  it('returns partial when npm audit only in workflow (no config file)', () => {
    const wfRoot = join(tmpdir(), `arbiter-n56-wf-${process.pid}`)
    mkdirSync(join(wfRoot, '.github/workflows'), { recursive: true })
    writeFileSync(join(wfRoot, 'package.json'), '{}')
    writeFileSync(
      join(wfRoot, '.github/workflows/audit.yml'),
      'name: audit\nsteps:\n  - run: npm audit --audit-level=high\n',
    )
    try {
      clearMeasureCache()
      const result = measureDim(dim('N56', 'security'), wfRoot)
      expect(result.status).toBe('partial')
      expect(result.evidence.length).toBeGreaterThan(0)
    } finally {
      rmSync(wfRoot, { recursive: true, force: true })
    }
  })
})

// ─── cicd — N39: runner label (compound) ─────────────────────────────────────

describe('cicd — N39: self-hosted runner label (compound)', () => {
  it('returns present when CI_BUILD_RUNNER_LABEL appears in a workflow', () => {
    // fixtureRoot 03-ci.yml has CI_BUILD_RUNNER_LABEL
    const result = measureDim(dim('N39', 'cicd'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })

  it('returns partial (non-empty evidence) when workflows exist but none reference CI_BUILD_RUNNER_LABEL', () => {
    const noLabelRoot = join(tmpdir(), `arbiter-n39-nolabel-${process.pid}`)
    mkdirSync(join(noLabelRoot, '.github/workflows'), { recursive: true })
    writeFileSync(join(noLabelRoot, 'package.json'), '{}')
    writeFileSync(
      join(noLabelRoot, '.github/workflows/ci.yml'),
      'name: ci\nruns-on: ubuntu-latest\n',
    )
    try {
      clearMeasureCache()
      const result = measureDim(dim('N39', 'cicd'), noLabelRoot)
      expect(result.status).toBe('partial')
      expect(result.evidence.length).toBeGreaterThanOrEqual(1)
    } finally {
      rmSync(noLabelRoot, { recursive: true, force: true })
    }
  })
})

// ─── git_github ───────────────────────────────────────────────────────────────

describe('git_github — N59/N61/N62', () => {
  it('N59 returns present when commitlint.config.js exists', () => {
    const result = measureDim(dim('N59', 'git_github'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })

  it('N61 returns present when .github/pull_request_template.md exists', () => {
    const result = measureDim(dim('N61', 'git_github'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('.github/pull_request_template.md')
  })

  it('N62 returns present when .github/ISSUE_TEMPLATE/ has files', () => {
    const result = measureDim(dim('N62', 'git_github'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── documentation ────────────────────────────────────────────────────────────

describe('documentation — N63/N65', () => {
  it('N63 returns present when AGENTS.md exists', () => {
    const result = measureDim(dim('N63', 'documentation'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('AGENTS.md')
  })

  it('N65 returns present when docs/adr/ dir exists', () => {
    const result = measureDim(dim('N65', 'documentation'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── configuration ────────────────────────────────────────────────────────────

describe('configuration — N69/N70', () => {
  it('N69 returns present when .nvmrc exists', () => {
    const result = measureDim(dim('N69', 'configuration'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('.nvmrc')
  })

  it('N70 returns present when .env.example exists', () => {
    const result = measureDim(dim('N70', 'configuration'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('.env.example')
  })
})

// ─── a11y ────────────────────────────────────────────────────────────────────

describe('a11y — N76: accessibility tooling', () => {
  it('returns present when axe-core in devDependencies', () => {
    // fixtureRoot package.json has axe-core in devDependencies
    const result = measureDim(dim('N76', 'a11y'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── module_boundaries ───────────────────────────────────────────────────────

describe('module_boundaries — N77: spring-modulith', () => {
  it('returns present when spring-modulith in pom.xml', () => {
    // fixtureRoot pom.xml has spring-modulith dep
    const result = measureDim(dim('N77', 'module_boundaries'), fixtureRoot)
    expect(result.status).toBe('present')
    expect(result.evidence.length).toBeGreaterThanOrEqual(1)
  })
})

describe('resilience — N78: resilience patterns guide', () => {
  let resRoot: string

  beforeEach(() => {
    resRoot = mkdtempSync(join(tmpdir(), 'n78-test-'))
  })

  afterEach(() => {
    rmSync(resRoot, { recursive: true, force: true })
  })

  it('returns present when docs/GOVERNANCE/RESILIENCE.md exists', () => {
    mkdirSync(join(resRoot, 'docs', 'GOVERNANCE'), { recursive: true })
    writeFileSync(join(resRoot, 'docs', 'GOVERNANCE', 'RESILIENCE.md'), '# Resilience\n')
    clearMeasureCache()
    const result = measureDim(dim('N78', 'resilience'), resRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('docs/GOVERNANCE/RESILIENCE.md')
  })

  it('returns present when cockatiel in package.json', () => {
    writeFileSync(
      join(resRoot, 'package.json'),
      JSON.stringify({ dependencies: { cockatiel: '^3.0.0' } }),
    )
    clearMeasureCache()
    const result = measureDim(dim('N78', 'resilience'), resRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('package.json')
  })

  it('returns present when resilience4j in pom.xml', () => {
    writeFileSync(
      join(resRoot, 'pom.xml'),
      '<dependency><groupId>io.github.resilience4j</groupId></dependency>',
    )
    clearMeasureCache()
    const result = measureDim(dim('N78', 'resilience'), resRoot)
    expect(result.status).toBe('present')
    expect(result.evidence).toContain('pom.xml')
  })

  it('returns missing when no resilience signals found', () => {
    clearMeasureCache()
    const result = measureDim(dim('N78', 'resilience'), resRoot)
    expect(result.status).toBe('missing')
    expect(result.evidence).toHaveLength(0)
  })
})
