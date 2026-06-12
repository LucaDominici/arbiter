import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { computeMetricsProfile } from '../../src/generators/debt-ratchet.js'

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

  it('Go: emits go test BDD runCheck', () => {
    const data = makeConfig('/tmp/test', {
      language: 'go',
      governanceLevel: 'L2',
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>
    const content = renderTemplate('scripts/check-all.mjs.ejs', data)
    expect(content).toContain("runCheck('bdd', 'go', ['test', './internal/bdd/...']")
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
    expect(content).toContain("runToolCheck('lint:css', 'npx', ['stylelint', 'src/**/*.css']")
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
    expect(content).toContain("runToolCheck('lint:css', 'npx', ['stylelint', 'src/**/*.css']")
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
