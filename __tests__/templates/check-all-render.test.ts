import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

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
