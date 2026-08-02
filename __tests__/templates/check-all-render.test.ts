import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { computeMetricsProfile } from '../../src/generators/debt-ratchet.js'

describe('check-hook-routing.mjs.ejs rendering (#2129)', () => {
  it('renders the fail-closed reverse-routing gate without EJS leakage', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-hook-routing.mjs.ejs', data)
    expect(content).toContain('Arbiter hook:')
    expect(content).toContain('UNROUTED')
    expect(content).toContain('process.exit(2)')
    expect(content).not.toContain('<%')
  })
})

describe('check-all.mjs.ejs rendering — Java wiring (#404)', () => {
  it('renders inline suppressions check when enableSuppressions=true (#367)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      enableSuppressions: true,
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('check-inline-suppressions.mjs')
  })

  it('renders inline suppressions check unconditionally even when enableSuppressions=false (CANON-09, #367)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      enableSuppressions: false,
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('check-inline-suppressions.mjs')
  })
  it('Java Gradle L2 coverageEnabled=false: coverage check omitted', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
      coverageEnabled: false,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('jacocoTestCoverageVerification')
  })

  it('Java Maven L2 coverageEnabled=false: coverage check omitted', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'maven',
      enableDebtGates: true,
      coverageEnabled: false,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('verify -Pjacoco')
  })

  it('Java Gradle L2: SpotBugs uses { soft: graceActive } matching PMD and JaCoCo', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
      coverageEnabled: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain(
      "runCheck('spotbugs', './gradlew', ['spotbugsMain', '-q'], { soft: graceActive })",
    )
    // Verify no hard-wired (non-soft) duplicate exists
    const spotbugsLines = content.split('\n').filter((l) => l.includes("runCheck('spotbugs'"))
    expect(spotbugsLines).toHaveLength(1)
    expect(spotbugsLines[0]).toContain('graceActive')
  })

  it('Java Maven L2: SpotBugs uses { soft: graceActive } matching PMD and JaCoCo', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'maven',
      enableDebtGates: true,
      coverageEnabled: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain(
      "runCheck('spotbugs', 'mvn', ['com.github.spotbugs:spotbugs-maven-plugin:check', '-q'], { soft: graceActive })",
    )
    const spotbugsLines = content.split('\n').filter((l) => l.includes("runCheck('spotbugs'"))
    expect(spotbugsLines).toHaveLength(1)
    expect(spotbugsLines[0]).toContain('graceActive')
  })
})

describe('check-all.mjs.ejs rendering — BDD gate (#361)', () => {
  it('TypeScript: emits cucumber-js BDD runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('bdd', 'npx', ['cucumber-js']")
  })

  it('Python: emits pytest BDD runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'python',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('bdd', 'pytest', ['tests/bdd/']")
  })

  it('Go: emits go test BDD runCheck (build-tag isolated, godog-gated) (#1042)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'go',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    // BDD test is `//go:build bdd`-tagged; the gate runs it with `-tags bdd` and
    // only when godog is actually wired into go.mod — otherwise SKIPs cleanly.
    expect(content).toContain(
      "runCheck('bdd', 'go', ['test', '-tags', 'bdd', './internal/bdd/...']",
    )
    expect(content).toContain("_goMod.includes('github.com/cucumber/godog')")
  })

  it('Java Gradle: emits cucumberTest BDD runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('bdd', './gradlew', ['cucumberTest']")
  })

  it('Rust: emits cargo test BDD runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'rust',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('bdd', 'cargo', ['test', '--features', 'bdd']")
  })

  it('TypeScript: @ignore grep step is HARD-fail (soft: false)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('@ignore')
    expect(content).toContain('soft: false')
  })
})

describe('check-all.mjs.ejs rendering — Python e2e gate (#366, migrated by #348)', () => {
  it('Python frontend-spa: emits pytest-playwright e2e via runToolCheck + ephemeral-server', () => {
    const data = makeConfig('/tmp/test', {
      language: 'python',
      archetype: 'frontend-spa',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toMatch(/runToolCheck\(\s*'pytest-playwright e2e'/)
    expect(content).toContain('scripts/lib/ephemeral-server.mjs')
    expect(content).toContain('pytest tests/e2e')
  })

  it('Python library: does NOT emit pytest-playwright e2e step', () => {
    const data = makeConfig('/tmp/test', {
      language: 'python',
      archetype: 'library',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain("'pytest-playwright e2e'")
  })
})

// F17 — contract gate command fixes (#376)
describe('check-all.mjs.ejs — contract gate commands (F17)', () => {
  const contractTypes = ['rest-owned', 'rest-public', 'graphql', 'grpc', 'message-queue'] as const

  const rustTargets: Record<string, string> = {
    'rest-owned': 'pact_consumer_test',
    'rest-public': 'openapi_diff_test',
    graphql: 'graphql_schema_test',
    grpc: 'grpc_contract_test',
    'message-queue': 'schema_registry_test',
  }

  for (const ct of contractTypes) {
    it(`Rust ${ct}: uses cargo test --test ${rustTargets[ct]}`, () => {
      const data = makeConfig('/tmp/test', {
        language: 'rust',
        contractType: ct,
        governanceLevel: 'L2',
        coverageEnabled: false,
        coverageThreshold: 80,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      expect(content).toContain(`--test', '${rustTargets[ct]}'`)
      expect(content).not.toContain('*contract*')
    })
  }

  it('Go: uses go test -tags contract (no change needed, verified)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'go',
      contractType: 'rest-owned',
      governanceLevel: 'L2',
      coverageEnabled: false,
      coverageThreshold: 80,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("'-tags', 'contract'")
  })

  for (const contractType of ['rest-owned', 'graphql', 'grpc', 'message-queue'] as const) {
    it(`Python ${contractType}: uses pytest tests/contract/ path`, () => {
      const data = makeConfig('/tmp/test', {
        language: 'python',
        contractType,
        governanceLevel: 'L2',
        coverageEnabled: false,
        coverageThreshold: 80,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      expect(content).toContain('tests/contract/')
    })
  }
})

// ─── #210: summary table, CI detection, ANSI strip, ::error:: annotations ────

describe('check-all.mjs.ejs rendering — summary table + CI annotations (#210, CANON-04)', () => {
  it('rendered script contains IS_CI detection', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('IS_CI')
  })

  it('rendered script imports helper trinity from ./lib/run-helpers.mjs (#351, CANON-01)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("from './lib/run-helpers.mjs'")
    expect(content).toContain('runCheck')
    expect(content).toContain('pushResult')
    expect(content).toContain('getResults')
    expect(content).toContain('getFailed')
  })

  it('rendered script uses pushResult for ad-hoc gates (replaces inline results.push)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("pushResult('workflow runners'")
    expect(content).toContain("pushResult('ci alignment'")
    expect(content).not.toContain('results.push(')
    expect(content).not.toMatch(/^\s*failed\+\+;\s*$/m)
  })

  it('rendered script contains summary table', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('=== Summary ===')
    expect(content).toContain('Elapsed')
    expect(content).toContain('Total')
  })

  it('helper template (lib/run-helpers.mjs.ejs) carries CI annotations and stripAnsi (#351)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/lib/run-helpers.mjs.ejs', data)
    expect(content).toContain('stripAnsi')
    expect(content).toContain('::error::')
    expect(content).toContain('export function runCheck')
    expect(content).toContain('export function runWarnCheck')
    expect(content).toContain('export function runToolCheck')
    expect(content).toContain('export function pushResult')
  })
})

describe('check-all.mjs.ejs — F10 cargo integration test flag (#369)', () => {
  it("Rust L2: uses '--tests' flag not '*integration*' glob", () => {
    const data = makeConfig('/tmp/test', {
      language: 'rust',
      buildTool: 'cargo',
      hasDatabase: true,
      governanceLevel: 'L2',
      coverageEnabled: false,
      coverageThreshold: 80,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("'--tests'")
    expect(content).not.toContain("'*integration*'")
  })
})

// ─── Matrix proven tool gate assertions (#171) ─────────────────────────────

describe('check-all.mjs.ejs — matrix proven tool gates (#171)', () => {
  describe('govulncheck — Go L2 (proven in matrix)', () => {
    it('Go L2 with security scanning: emits govulncheck', () => {
      const data = makeConfig('/tmp/test', {
        language: 'go',
        governanceLevel: 'L2',
        enableSecurityScanning: true,
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      expect(content).toContain('govulncheck')
    })

    it('Go L1: does NOT emit govulncheck', () => {
      const data = makeConfig('/tmp/test', {
        language: 'go',
        governanceLevel: 'L1',
        enableSecurityScanning: false,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      expect(content).not.toContain('govulncheck')
    })

    it('TypeScript L2: does NOT emit govulncheck', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
        enableSecurityScanning: true,
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      expect(content).not.toContain('govulncheck')
    })
  })

  describe('playwright e2e — TypeScript frontend-spa L2 (proven in matrix, #348)', () => {
    it('TypeScript frontend-spa L2: emits playwright e2e gate via runToolCheck + ephemeral-server', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        archetype: 'frontend-spa',
        governanceLevel: 'L2',
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      expect(content).toMatch(/runToolCheck\(\s*'playwright e2e'/)
      expect(content).toContain('scripts/lib/ephemeral-server.mjs')
      expect(content).toContain('npx playwright test')
    })

    it('TypeScript library L2: does NOT emit playwright e2e step', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        archetype: 'library',
        governanceLevel: 'L2',
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      expect(content).not.toContain("'playwright e2e'")
    })

    it('TypeScript frontend-spa L1: does NOT emit playwright e2e step at L2 block', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        archetype: 'frontend-spa',
        governanceLevel: 'L1',
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      expect(content).not.toContain("'playwright e2e'")
    })

    it('Go frontend-spa L2: does NOT emit playwright e2e step', () => {
      const data = makeConfig('/tmp/test', {
        language: 'go',
        archetype: 'frontend-spa',
        governanceLevel: 'L2',
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      expect(content).not.toContain("'playwright e2e'")
    })
  })
})

// ─── #284: architecture tests gate broadened to layered + modular-monolith ───

describe('check-all.mjs.ejs — architecture tests gate (#284)', () => {
  it('Java Gradle layered + basePackage: emits architecture tests runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      architectureStyle: 'layered',
      basePackage: 'com.example.app',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('architecture tests'")
    expect(content).toContain('*.architecture.*')
  })

  it('Java Gradle modular-monolith + basePackage: emits architecture tests runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      architectureStyle: 'modular-monolith',
      basePackage: 'com.example.app',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('architecture tests'")
    expect(content).toContain('*.architecture.*')
  })

  it('Java Gradle hexagonal + basePackage: still emits architecture tests runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      architectureStyle: 'hexagonal',
      basePackage: 'com.example.app',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('architecture tests'")
  })

  it('Java Gradle none architectureStyle: does NOT emit architecture tests runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      architectureStyle: 'none',
      basePackage: 'com.example.app',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain("runCheck('architecture tests'")
  })

  it('Java Gradle layered without basePackage: does NOT emit architecture tests runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      architectureStyle: 'layered',
      basePackage: undefined,
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain("runCheck('architecture tests'")
  })

  it('Java Maven layered + basePackage: emits architecture tests runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'maven',
      architectureStyle: 'layered',
      basePackage: 'com.example.app',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('architecture tests'")
    expect(content).toContain('*.architecture.*')
  })
})

// ─── #347: Mutation gate wiring (CANON-02/09/15) ─────────────────────────────

describe('check-all.mjs.ejs — mutation gate wiring (#347, CANON-02/09/15)', () => {
  it('TS L2 with mutationEnabled+enableMutationTesting: emits stryker runToolCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
      enableMutationTesting: true,
    }) as unknown as Record<string, unknown>
    ;(data as Record<string, unknown>).mutationEnabled = true
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runToolCheck('mutation (stryker)', 'npx', ['stryker', 'run']")
  })

  it('TS L1: does NOT emit stryker step (L2 only)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
      enableMutationTesting: true,
    }) as unknown as Record<string, unknown>
    ;(data as Record<string, unknown>).mutationEnabled = true
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain("'stryker'")
  })

  it('TS L2 with enableMutationTesting=false: does NOT emit stryker step', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
      enableMutationTesting: false,
    }) as unknown as Record<string, unknown>
    ;(data as Record<string, unknown>).mutationEnabled = true
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain("'stryker'")
  })

  it('TS L2 with mutationEnabled=false: does NOT emit stryker step', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
      enableMutationTesting: true,
    }) as unknown as Record<string, unknown>
    ;(data as Record<string, unknown>).mutationEnabled = false
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain("'stryker'")
  })

  it('Java Gradle L2: emits pitest gradle runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L2',
      coverageEnabled: false,
      enableMutationTesting: true,
    }) as unknown as Record<string, unknown>
    ;(data as Record<string, unknown>).mutationEnabled = true
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('mutation (pitest)', './gradlew', ['pitest', '-q']")
  })

  it('Java Maven L2: emits pitest maven runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'maven',
      governanceLevel: 'L2',
      coverageEnabled: false,
      enableMutationTesting: true,
    }) as unknown as Record<string, unknown>
    ;(data as Record<string, unknown>).mutationEnabled = true
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain(
      "runCheck('mutation (pitest)', 'mvn', ['org.pitest:pitest-maven:mutationCoverage', '-q']",
    )
  })

  it('Rust L2 (beta in matrix): does NOT emit mutation step (CANON-02)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'rust',
      governanceLevel: 'L2',
      coverageEnabled: false,
      enableMutationTesting: true,
    }) as unknown as Record<string, unknown>
    ;(data as Record<string, unknown>).mutationEnabled = true
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('cargo-mutants')
    expect(content).not.toContain("'cargo', ['mutants'")
  })

  it('Go L2 (unsafe in matrix): does NOT emit mutation step (CANON-02)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'go',
      governanceLevel: 'L2',
      coverageEnabled: false,
      enableMutationTesting: true,
    }) as unknown as Record<string, unknown>
    ;(data as Record<string, unknown>).mutationEnabled = true
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('go-mutesting')
    expect(content).not.toContain("'mutation (go-mutesting)'")
  })

  it('Python L2 (beta in matrix): does NOT emit mutation step (CANON-02)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'python',
      governanceLevel: 'L2',
      coverageEnabled: false,
      enableMutationTesting: true,
    }) as unknown as Record<string, unknown>
    ;(data as Record<string, unknown>).mutationEnabled = true
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('mutmut')
  })
})

// ─── #352: Stylelint + design-token enforcement (CANON-02/15) ────────────────

describe('check-all.mjs.ejs — stylelint gate wiring (#352, CANON-02/15)', () => {
  it('TS frontend-spa L1: emits stylelint runToolCheck gated on a present config', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'frontend-spa',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain(
      "runToolCheck('lint:css', 'npx', ['stylelint', '--allow-empty-input', 'src/**/*.css']",
    )
    // gate-on-present: non-frontend/partial targets won't have .stylelintrc, so CI must not FAIL when it is absent (#352 config emitted by frontend-quality for FE-TS targets, PR #1138)
    expect(content).toContain("if (existsSync('.stylelintrc.json') || existsSync('.stylelintrc'))")
  })

  it('TS library L1: does NOT emit stylelint step (archetype gate)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'library',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('stylelint')
  })

  it('Rust frontend-spa L1: does NOT emit stylelint step (TS-only)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'rust',
      archetype: 'frontend-spa',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('stylelint')
  })

  it('TS frontend-spa L2: still emits stylelint (L1 step always runs)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'frontend-spa',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain(
      "runToolCheck('lint:css', 'npx', ['stylelint', '--allow-empty-input', 'src/**/*.css']",
    )
  })
})

// ─── #1312: stack-conformity gate wiring (INV-121, CANON-01) ─────────────────

describe('check-all.mjs.ejs — stack-conformity gate wiring (#1312, INV-121)', () => {
  it('renders the conformity runCheck when language is set', () => {
    const data = makeConfig('/tmp/test', {
      language: 'go',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain(
      "runCheck('stack conformity (INV-121)', 'node', ['scripts/check-stack-conformity.mjs'])",
    )
  })

  it('does NOT render the conformity runCheck when language is absent', () => {
    const base = makeConfig('/tmp/test', { governanceLevel: 'L1' }) as unknown as Record<
      string,
      unknown
    >
    // render-assertion (not dogfood byte-parity): an undeclared-language target must
    // not wire a runCheck for a script the registry won't emit (INV-121 #1312).
    const data = { ...base, language: '' }
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('scripts/check-stack-conformity.mjs')
  })
})

// ─── #1737: consumer-resolution audit gate wiring (CANON-01 Track-B counterpart
// of arbiter-self's own #1718) ────────────────────────────────────────────────

describe('check-all.mjs.ejs — consumer audit gate wiring (#1737)', () => {
  it('TS library L2: emits the consumer audit runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'library',
      governanceLevel: 'L2',
      // renderTemplate is called directly here (bypassing generateCheckAll), so the
      // derived coverageEnabled field (normally injected by resolveEffectiveThresholds)
      // must be supplied manually — mirrors the pre-existing stylelint-gate test above.
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain(
      "runCheck('consumer audit', 'node', ['scripts/check-consumer-audit.mjs'])",
    )
  })

  it('TS cli L2: does NOT emit the consumer audit runCheck (non-library archetype)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'cli',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('check-consumer-audit.mjs')
  })

  it('Python library L2: does NOT emit the consumer audit runCheck (TS-only)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'python',
      archetype: 'library',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('check-consumer-audit.mjs')
  })

  it('TS library L1: does NOT emit the consumer audit runCheck (L2-only security block)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'library',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('check-consumer-audit.mjs')
  })
})

describe('static-analysis/jscpd.json.ejs (CANON-22 duplication config)', () => {
  it('renders valid JSON with the governance-scaled threshold + v5 path/format fileset (catches EJS drift)', () => {
    const base = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('static-analysis/jscpd.json.ejs', {
      ...base,
      duplicationThreshold: 5,
    })
    const parsed = JSON.parse(content) as Record<string, unknown>
    expect(parsed.threshold).toBe(5)
    expect(parsed.minTokens).toBe(50)
    // jscpd v5 ignores `pattern` (silent 0-file scan) — config must carry
    // `path` (positional-arg SSOT for the generated scripts) + `format` (#1286)
    expect(parsed.pattern).toBeUndefined()
    expect(parsed.path).toEqual(['src'])
    expect(parsed.format).toContain('typescript')
    expect(Array.isArray(parsed.ignore)).toBe(true)
  })

  it('generated check-all routes duplication through the fail-closed gate script (#1286)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      enableDebtGates: true,
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    // bare `npx jscpd --silent` exits 0 on a 0-file scan under v5 — vacuous gate
    expect(content).not.toContain("['jscpd', '--silent']")
    expect(content).toContain('check-duplication.mjs')
  })

  it('generated debt-lib uses jscpdScan (positional paths, --no-install, fail-closed) (#1286)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>
    const cfg = makeConfig('/tmp/test', { language: 'typescript', enableDebtGates: true })
    const content = renderTemplate('scripts/debt-lib.mjs.ejs', {
      ...data,
      metricsProfile: computeMetricsProfile(cfg),
    })
    expect(content).toContain('jscpdScan')
    expect(content).toContain('--no-install')
    // v4-era false premise must be gone: v5 always writes the json report
    expect(content).not.toContain('ONLY when clones are found')
  })

  it('generated check-duplication.mjs is a fail-closed gate (config error / 0 sources → exit 1) (#1286)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-duplication.mjs.ejs', data)
    expect(content).toContain('jscpdScan')
    expect(content).toContain('process.exit(1)')
  })

  it('generated debt-report hard-fails the gate on collection errors (#1286)', () => {
    const cfg = makeConfig('/tmp/test', { language: 'typescript', enableDebtGates: true })
    const data = {
      ...cfg,
      metricsProfile: computeMetricsProfile(cfg),
    } as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/debt-report.mjs.ejs', data)
    expect(content).toContain('collectMetrics(cwd, collectionErrors)')
    expect(content).toContain('collection FAILURE')
    expect(content).toContain('process.exit(1)')
  })

  it('generated capture-debt-baseline refuses to drop previously-present metric keys (#1286)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/capture-debt-baseline.mjs.ejs', data)
    expect(content).toContain('assertKeyParity')
  })

  it('interpolates a stricter threshold at higher governance', () => {
    const base = makeConfig('/tmp/test', { language: 'typescript' }) as unknown as Record<
      string,
      unknown
    >
    const l3 = JSON.parse(
      renderTemplate('static-analysis/jscpd.json.ejs', { ...base, duplicationThreshold: 3 }),
    )
    expect(l3.threshold).toBe(3)
  })
})

describe('static-analysis/stylelintrc.json.ejs (#352 design-token config)', () => {
  it('renders valid JSON with the HARD design-token rules (catches EJS drift)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'frontend-spa',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('static-analysis/stylelintrc.json.ejs', data)
    const cfg = JSON.parse(content) as { rules: Record<string, unknown> }
    expect(cfg.rules['color-no-hex']).toBeDefined()
    expect(cfg.rules['length-zero-no-unit']).toBe(true)
    expect(cfg.rules['custom-property-no-missing-var-function']).toBe(true)
    // no `extends`/plugins — design-token enforcement only, brownfield-safe
    expect(content).not.toContain('"extends"')
  })
})

describe('check-all.mjs.ejs rendering — wiki-lint L1 gating (#1318/#1321)', () => {
  // The wiki generator is enabled only at L2+ (registry.ts), so a virgin L1
  // project never emits scripts/check-wiki-lint.mjs. The runCheck reference must
  // be gated to match, or `check-all L1` RED with MODULE_NOT_FOUND.
  it('L1: does NOT reference check-wiki-lint.mjs (script not emitted at L1)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('check-wiki-lint.mjs')
  })

  it('L2: DOES reference check-wiki-lint.mjs (wiki generator emits it at L2+)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('check-wiki-lint.mjs')
  })
})

// #1491 / B3 — every run-helper called in the generated gate MUST be imported, or the
// generated check-all.mjs throws a runtime ReferenceError mid-gate (never reaching the
// Summary / writing the pass marker). String-match render tests missed this; this guard
// asserts import↔usage parity for the run-helper trinity across representative configs.
describe('check-all.mjs.ejs — run-helper import↔usage parity (#1491, B3)', () => {
  const RUN_HELPERS = ['runCheck', 'runWarnCheck', 'runToolCheck'] as const

  function importedRunHelpers(content: string): Set<string> {
    const m = content.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/lib\/run-helpers\.mjs'/)
    expect(m, 'run-helpers import block must exist in rendered check-all.mjs').toBeTruthy()
    return new Set(
      m![1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
  }

  // enableDebtGates (not coverage) is what renders the runWarnCheck call sites; coverageEnabled
  // is set explicitly because the template references it in a scriptlet (undefined → render
  // ReferenceError). The java case keeps coverage on to also exercise the coverage path.
  for (const cfg of [
    {
      language: 'typescript',
      enableDebtGates: true,
      coverageEnabled: false,
      governanceLevel: 'L2',
    },
    {
      language: 'typescript',
      enableDebtGates: true,
      coverageEnabled: false,
      governanceLevel: 'L3',
    },
    { language: 'python', enableDebtGates: true, coverageEnabled: false, governanceLevel: 'L2' },
    {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
      coverageEnabled: true,
      governanceLevel: 'L2',
    },
  ] as const) {
    const label = `${cfg.language}${'buildTool' in cfg ? '/' + cfg.buildTool : ''} ${cfg.governanceLevel}`
    it(`${label}: no run-helper is called without being imported`, () => {
      const data = makeConfig('/tmp/test', cfg as Record<string, unknown>) as unknown as Record<
        string,
        unknown
      >
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      const imported = importedRunHelpers(content)
      for (const helper of RUN_HELPERS) {
        const calledInBody = new RegExp(`\\b${helper}\\s*\\(`).test(content)
        if (calledInBody) {
          expect(
            imported.has(helper),
            `${helper}() is called in the generated gate but not imported from run-helpers.mjs → ReferenceError at runtime`,
          ).toBe(true)
        }
      }
    })
  }
})

// #1720 — gap 4: the runtime full-gate guard was the literal `if (level === 'L2')`, so
// running the GENERATED `check-all.mjs L3` or `check-all.mjs L4` silently ran only the
// L1 checks — a runtime lie (the arg parser accepts L3/L4 as valid but they are weaker
// than L2). L3/L4 have no dedicated runtime lane in this gate: L2 ("full") is the
// strongest tier it implements, and every governanceLevel-specific check is compiled in
// at generation time. The fix is a CLAMP immediately after arg-parse — `if (level ===
// 'L3' || level === 'L4') level = 'L2';` — so an L3/L4 request runs the full gate body
// (never the L1 subset) and the `level` stamped into the JSON/evidence artifacts stays
// honest (never fabricates an L3/L4 conformance label for a lane that only ran L2
// checks). The line-540 guard itself is intentionally left UNCHANGED — rewriting it to
// admit L3/L4 directly (e.g. `level !== 'L1'`) would leave `level` at 'L3'/'L4' and
// stamp that into the persisted gate-pass evidence while only L2 checks ran: a new
// fake-green surface. This is level-INDEPENDENT: the clamp is rendered at every
// governanceLevel (unlike gaps 1/2/3/5, which are gated by governanceLevel at render
// time).
describe('check-all.mjs.ejs — gap 4: L3/L4 clamp to the L2 full-gate lane (#1720)', () => {
  it("still contains the unchanged `if (level === 'L2')` full-gate guard", () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      enableDebtGates: true,
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("if (level === 'L2') {")
  })

  it("contains the post-parse clamp to 'L2' for an explicit L3/L4 request, and warns loudly", () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      enableDebtGates: true,
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("if (level === 'L3' || level === 'L4') {")
    // The clamp is LOUD (#1720: the bug class is SILENT downgrades — the clamp
    // itself must never be one): a stderr warn names both the requested and the
    // effective level before the reassignment.
    expect(content).toContain('clamps to L2')
    expect(content).toContain("level = 'L2';")
    // The clamp must appear AFTER the arg-parse block closes and BEFORE the full-gate
    // guard, so `level` is normalized before either the banner log or the L2 branch
    // reads it.
    const argParseEndIdx = content.indexOf('<<< ARG-PARSE-END')
    const clampIdx = content.indexOf("if (level === 'L3' || level === 'L4') {")
    const guardIdx = content.indexOf("if (level === 'L2') {")
    expect(argParseEndIdx).toBeGreaterThan(-1)
    expect(clampIdx).toBeGreaterThan(argParseEndIdx)
    expect(guardIdx).toBeGreaterThan(clampIdx)
  })

  it('renders the clamp identically at governanceLevel L2/L3/L4 (level-independent fix)', () => {
    const contents = (['L2', 'L3', 'L4'] as const).map((governanceLevel) => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel,
        enableDebtGates: true,
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>
      return renderTemplate('scripts/check-all.mjs.ejs', data)
    })
    for (const content of contents) {
      expect(content).toContain("if (level === 'L3' || level === 'L4') {")
      expect(content).toContain("level = 'L2';")
      expect(content).toContain("if (level === 'L2') {")
    }
  })

  // Behavioral proof of the runtime path (not just the emitted string): execute the
  // rendered script's real arg-parse + clamp region — everything up to the Grace
  // Period Guard, with the run-helpers import satisfied by a no-op stub — and probe
  // the effective `level`. This is exactly the code a target project runs.
  describe('behavioral: rendered parse+clamp region executed with node', () => {
    function runParseAndClamp(args: string[]): {
      status: number
      stderr: string
      level: string | null
    } {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
        enableDebtGates: true,
        coverageEnabled: false,
      }) as unknown as Record<string, unknown>
      const content = renderTemplate('scripts/check-all.mjs.ejs', data)
      const cutIdx = content.indexOf('Grace Period Guard')
      expect(cutIdx).toBeGreaterThan(-1)
      const prefix = content.slice(0, content.lastIndexOf('\n', cutIdx))
      const probe = `${prefix}\nconsole.log(JSON.stringify({ __probeLevel: level }));\nprocess.exit(0);\n`
      const dir = mkdtempSync(join(tmpdir(), 'check-all-clamp-'))
      try {
        const scriptsDir = join(dir, 'scripts')
        mkdirSync(join(scriptsDir, 'lib'), { recursive: true })
        writeFileSync(join(scriptsDir, 'check-all.mjs'), probe)
        writeFileSync(
          join(scriptsDir, 'lib', 'run-helpers.mjs'),
          'export const runCheck = () => {};\nexport const runWarnCheck = () => {};\nexport const runToolCheck = () => {};\nexport const pushResult = () => {};\nexport const getResults = () => [];\nexport const getFailed = () => [];\nexport const setMode = () => {};\n' +
            // #2104: the gate resolves a tmpfs TMPDIR before any spawn. Stubbed to null so
            // this probe stays hermetic (no TMPDIR mutation) and host-independent.
            'export const resolveTmpfsTmpdir = () => null;\n',
        )
        const r = spawnSync('node', [join(scriptsDir, 'check-all.mjs'), ...args], {
          encoding: 'utf-8',
          cwd: dir,
        })
        const m = /\{"__probeLevel":"(L\d)"\}/.exec(r.stdout ?? '')
        return { status: r.status ?? 1, stderr: r.stderr ?? '', level: m ? m[1] : null }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    it('L4 request clamps to L2 and warns on stderr', () => {
      const { status, stderr, level } = runParseAndClamp(['L4'])
      expect(status).toBe(0)
      expect(level).toBe('L2')
      expect(stderr).toContain('clamps to L2')
    })

    it('L3 request clamps to L2 and warns on stderr', () => {
      const { level, stderr } = runParseAndClamp(['L3'])
      expect(level).toBe('L2')
      expect(stderr).toContain('clamps to L2')
    })

    it('L1/L2 requests pass through unchanged with no clamp warning', () => {
      for (const requested of ['L1', 'L2'] as const) {
        const { level, stderr } = runParseAndClamp([requested])
        expect(level).toBe(requested)
        expect(stderr).not.toContain('clamps to L2')
      }
    })
  })
})

// #1835: self-validation.mjs (the A/B/C "prove the gate bites" drill) was emitted
// by every project (enableSelfValidationHarness !== false ⇒ default true) but never
// referenced anywhere — a config flag implying an active drill that never runs.
describe('check-all.mjs.ejs rendering — self-validation drill wiring (#1835)', () => {
  it('references self-validation.mjs when the harness is on (default)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('scripts/self-validation.mjs')
  })

  it('does not reference self-validation.mjs when the harness is explicitly off', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
      enableSelfValidationHarness: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('scripts/self-validation.mjs')
  })
})

// #1835: audit-toolchain.mjs was emitted unconditionally for every project and never
// referenced anywhere. Made explicit opt-in (config.enableAuditToolchain); wiring
// must track emission exactly (never emitted-without-wired, never wired-without-emitted).
describe('check-all.mjs.ejs rendering — audit-toolchain opt-in wiring (#1835)', () => {
  it('does not reference audit-toolchain.mjs by default', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('audit-toolchain.mjs')
  })

  it('references audit-toolchain.mjs when explicitly opted in', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
      enableAuditToolchain: true,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('scripts/audit-toolchain.mjs')
  })
})

// #1835: discovered while fixing audit-toolchain's opt-in wiring — audit-toolchain.mjs
// was ALWAYS emitted before this fix and its content happened to mention
// "check-docs.mjs" (one of its hardcoded REQUIRED_SCRIPTS), which incidentally
// satisfied the emission-coherence reverse-check's naive string-match scan. Once
// audit-toolchain became opt-in (off by default), that accidental "cover" went away
// and revealed check-docs.mjs itself was a SEPARATE, real, pre-existing dead
// emission at L2+ (never referenced by check-all.mjs or anywhere else).
describe('check-all.mjs.ejs rendering — check-docs.mjs wiring (#356, #1835)', () => {
  it('references check-docs.mjs at L2+ (matches its own emission gate)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('scripts/check-docs.mjs')
  })

  it('does not reference check-docs.mjs at L1 (never emitted there)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('check-docs.mjs')
  })
})

// #1835 (scaffold-not-wired audit): check-domain-api-surface.mjs (INV-125) is emitted
// by emitDomainApiSurface (check-all.ts) whenever hasPublicApi is true, but the target
// check-all.mjs.ejs never referenced it — a dead gate (cost paid, zero enforcement),
// exactly the class #1835 tracks. Its sibling conditional gate check-consumer-audit.mjs
// IS wired (EJS-conditional on its own emission predicate); this one was not. Fix
// mirrors that precedent — the reference is gated by the SAME `hasPublicApi` predicate
// emitDomainApiSurface uses, not an existsSync runtime guard, so the static
// emission-coherence check (#1331) sees a reference iff the script is emitted for
// that same config (e.g. typescript/library without a public API never gets either).
describe('check-all.mjs.ejs rendering — domain-api-surface wiring (INV-125, #1835)', () => {
  it('references check-domain-api-surface.mjs when hasPublicApi=true (matches its emission gate)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'java',
      buildTool: 'gradle',
      hasPublicApi: true,
      coverageEnabled: true,
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('scripts/check-domain-api-surface.mjs')
  })

  it('does not reference check-domain-api-surface.mjs when hasPublicApi=false (never emitted there)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'library',
      hasPublicApi: false,
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('check-domain-api-surface.mjs')
  })
})

// #1887-B: check-feature-matrix.mjs / gen-gap.mjs are emitted by
// generateFeatureMatrix/generateGap at the identical L2+ gate
// (governanceLevel !== 'L1') — the reference must be gated the same way so
// the emission-coherence check never sees a dangling reference at L1.
describe('check-all.mjs.ejs rendering — feature-matrix/gap wiring (#1887-B)', () => {
  it('references check-feature-matrix.mjs and gen-gap.mjs at L2+ (matches their emission gate)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('scripts/check-feature-matrix.mjs')
    expect(content).toContain('scripts/gen-gap.mjs')
  })

  it('does not reference check-feature-matrix.mjs or gen-gap.mjs at L1 (never emitted there)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('check-feature-matrix.mjs')
    expect(content).not.toContain('gen-gap.mjs')
  })
})

// #2160 (AC-5): oracle-discrimination.mjs is emitted by emitOracleDiscrimination
// (check-all.ts) ONLY for an E2E-harness archetype — the check-all.mjs.ejs reference must be
// gated by the IDENTICAL predicate so a library/cli render never carries a dangling
// reference to a file that was never emitted (the emission-coherence ghost class, #1331).
describe('check-all.mjs.ejs rendering — oracle-discrimination emission↔wiring parity (#2160)', () => {
  it('references check-oracle-discrimination.mjs for a frontend-spa archetype (matches emission)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'frontend-spa',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('scripts/check-oracle-discrimination.mjs')
  })

  it('references check-oracle-discrimination.mjs for a backend-web-db archetype', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'backend-web-db',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain('scripts/check-oracle-discrimination.mjs')
  })

  it('does NOT reference check-oracle-discrimination.mjs for a library archetype (never emitted there)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      archetype: 'library',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).not.toContain('check-oracle-discrimination.mjs')
  })
})
