import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateContractTesting } from '../../src/generators/contract-testing.js'

describe('generateContractTesting', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  // ─── Gate: contractType="none" → empty ────────────────────────────────────

  it('returns empty when contractType is none for typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'none',
      governanceLevel: 'L2',
      language: 'typescript',
    })
    expect(generateContractTesting(config).files).toHaveLength(0)
  })

  it('returns empty when contractType is none for java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'none',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      expect(generateContractTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('returns empty when contractType is none for rust', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'none',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
      })
      expect(generateContractTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('returns empty when contractType is none for go', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        contractType: 'none',
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
      })
      expect(generateContractTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('returns empty when contractType is none for python', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        contractType: 'none',
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
      })
      expect(generateContractTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  // ─── Gate: governanceLevel=L1 → empty ─────────────────────────────────────

  it('returns empty when governanceLevel is L1 with rest-owned', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-owned',
      governanceLevel: 'L1',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(0)
  })

  it('returns empty when governanceLevel is L1 with rest-public', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-public',
      governanceLevel: 'L1',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(0)
  })

  it('returns empty when governanceLevel is L1 with graphql', () => {
    const config = makeConfig(dir, {
      contractType: 'graphql',
      governanceLevel: 'L1',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(0)
  })

  it('returns empty when governanceLevel is L1 with grpc', () => {
    const config = makeConfig(dir, {
      contractType: 'grpc',
      governanceLevel: 'L1',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(0)
  })

  it('returns empty when governanceLevel is L1 with message-queue', () => {
    const config = makeConfig(dir, {
      contractType: 'message-queue',
      governanceLevel: 'L1',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(0)
  })

  // ─── Gate: unknown contractType → warn+skip (#287) ───────────────────────

  it('warns and returns empty on unknown contractType', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const config = makeConfig(dir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'typescript',
        hasPublicApi: true,
      })
      // Override with unknown value via type cast
      ;(config as unknown as Record<string, unknown>)['contractType'] = 'soap'
      const result = generateContractTesting(config)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown contractType: soap'))
      expect(result).toEqual({ files: [] })
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('does not write CONTRACTS_POLICY.md when contractType is unknown', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const config = makeConfig(dir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'typescript',
        hasPublicApi: true,
      })
      ;(config as unknown as Record<string, unknown>)['contractType'] = 'webhook'
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(0)
      expect(existsSync(join(dir, 'CONTRACTS_POLICY.md'))).toBe(false)
    } finally {
      warnSpy.mockRestore()
    }
  })

  // ─── Gate: beta tools blocked when acceptBetaTools is false (#288) ─────────

  it('returns empty for rust when acceptBetaTools is false (rest-owned)', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
        hasPublicApi: true,
        acceptBetaTools: false,
      })
      expect(generateContractTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('returns empty for go when acceptBetaTools is false (rest-public)', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        contractType: 'rest-public',
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
        hasPublicApi: true,
        acceptBetaTools: false,
      })
      expect(generateContractTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('returns empty for python when acceptBetaTools is false (graphql)', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        contractType: 'graphql',
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
        hasPublicApi: true,
        acceptBetaTools: false,
      })
      expect(generateContractTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  it('emits files for rust when acceptBetaTools is true (rest-owned)', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      expect(generateContractTesting(config).files.length).toBeGreaterThan(0)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  // ─── Gate: hasPublicApi=false → empty (#289) ──────────────────────────────

  it('returns empty when hasPublicApi is false (typescript, rest-owned)', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-owned',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: false,
    })
    expect(generateContractTesting(config).files).toHaveLength(0)
  })

  it('returns empty when hasPublicApi is absent (typescript, rest-public)', () => {
    // makeConfig defaults hasPublicApi: false — so omitting it tests the absent case
    const config = makeConfig(dir, {
      contractType: 'rest-public',
      governanceLevel: 'L2',
      language: 'typescript',
    })
    expect(generateContractTesting(config).files).toHaveLength(0)
  })

  it('does not write CONTRACTS_POLICY.md when hasPublicApi is false', () => {
    const config = makeConfig(dir, {
      contractType: 'graphql',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: false,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'CONTRACTS_POLICY.md'))).toBe(false)
  })

  // ─── rest-owned × typescript: 2 files ────────────────────────────────────

  it('returns 4 files for rest-owned + typescript (.env.pact + pacts/.gitkeep added)', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-owned',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(4)
  })

  it('generates CONTRACTS_POLICY.md for rest-owned + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-owned',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'CONTRACTS_POLICY.md'))).toBe(true)
  })

  it('generates pact-consumer.test.ts for rest-owned + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-owned',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'src', 'test', 'contracts', 'pact-consumer.test.ts'))).toBe(true)
  })

  // ─── rest-owned × java: 3 files ──────────────────────────────────────────

  it('returns 27 files for rest-owned + java (F7 postman + F9 contract baselines added, #896)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      // 5 base (CONTRACTS_POLICY.md + .env.pact + pacts/.gitkeep + pact-deps.gradle + PactVerificationIT.java)
      // + 3 F7 (run-postman-tests.sh + inject-pact-samples.sh + _contract-postman.yml)
      // + 10 F9 api-snapshot stubs + 6 F9 pact-sample stubs + 3 F9 validator scripts
      expect(generateContractTesting(config).files).toHaveLength(27)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('generates PactVerificationIT.java at fallback path for rest-owned + java (no basePackage)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      generateContractTesting(config)
      expect(
        existsSync(join(javaDir, 'src', 'test', 'java', 'contracts', 'PactVerificationIT.java')),
      ).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('generates PactVerificationIT.java at package path for rest-owned + java (with basePackage)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        basePackage: 'com.example.myapp',
        hasPublicApi: true,
      })
      generateContractTesting(config)
      expect(
        existsSync(
          join(
            javaDir,
            'src',
            'test',
            'java',
            'com',
            'example',
            'myapp',
            'contracts',
            'PactVerificationIT.java',
          ),
        ),
      ).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('generates pact-deps.gradle for rest-owned + java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      generateContractTesting(config)
      expect(existsSync(join(javaDir, 'config', 'pact-deps.gradle'))).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // #1887-F: config/pact-deps.gradle was emitted but never wired into the root
  // build — same ghost class as #1886. No plugins{} block in the snippet (pure
  // deps + test{} config), so only the apply(from=...) line is needed.
  it('wires config/pact-deps.gradle into the root build via apply(from=...)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      generateContractTesting(config)
      const build = readFileSync(join(javaDir, 'build.gradle'), 'utf-8')
      expect(build).toContain("apply from: 'config/pact-deps.gradle'")
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // ─── rest-owned × rust: 2 files ──────────────────────────────────────────

  it('returns 4 files for rest-owned + rust (.env.pact + pacts/.gitkeep added)', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      expect(generateContractTesting(config).files).toHaveLength(4)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('generates tests/pact_consumer_test.rs for rest-owned + rust', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      generateContractTesting(config)
      expect(existsSync(join(rustDir, 'tests', 'pact_consumer_test.rs'))).toBe(true)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  // ─── rest-owned × go: 2 files ────────────────────────────────────────────

  it('returns 4 files for rest-owned + go (.env.pact + pacts/.gitkeep added)', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      expect(generateContractTesting(config).files).toHaveLength(4)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('generates tests/pact_consumer_test.go for rest-owned + go', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      generateContractTesting(config)
      expect(existsSync(join(goDir, 'tests', 'pact_consumer_test.go'))).toBe(true)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  // ─── rest-owned × python: 2 files ────────────────────────────────────────

  it('returns 4 files for rest-owned + python (.env.pact + pacts/.gitkeep added)', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      expect(generateContractTesting(config).files).toHaveLength(4)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  it('generates tests/contract/test_pact_consumer.py for rest-owned + python (F17)', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      generateContractTesting(config)
      expect(existsSync(join(pyDir, 'tests', 'contract', 'test_pact_consumer.py'))).toBe(true)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  // ─── rest-public × all languages ─────────────────────────────────────────

  it('returns 3 files for rest-public + typescript (diff test + exporter + policy)', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-public',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(3)
  })

  it('generates src/test/contracts/openapi-diff.ts + export-openapi.mjs for rest-public + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-public',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'src', 'test', 'contracts', 'openapi-diff.ts'))).toBe(true)
    // #1837: the exporter must be emitted alongside the diff test — the diff
    // test HARD-fails (INV-43) without contracts/openapi-current.yaml, which
    // only this script produces.
    expect(existsSync(join(dir, 'export-openapi.mjs'))).toBe(true)
  })

  it('returns 3 files for rest-public + java (diff test + gradle exporter + policy)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-public',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      expect(generateContractTesting(config).files).toHaveLength(3)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('generates OpenApiDiffIT.java + config/export-openapi-java.gradle for rest-public + java (no basePackage)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-public',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      generateContractTesting(config)
      expect(
        existsSync(join(javaDir, 'src', 'test', 'java', 'contracts', 'OpenApiDiffIT.java')),
      ).toBe(true)
      expect(existsSync(join(javaDir, 'config', 'export-openapi-java.gradle'))).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // #1887-F: config/export-openapi-java.gradle was emitted but never wired —
  // AND its template shape (a `plugins {}` block) is exactly what
  // safeApplyFromSnippet's load-bearing guard withholds (Gradle forbids the
  // plugins DSL in applied scripts). The plugin must move to the root build's
  // plugins block via injectGradleWiring; only the `openApi {}` extension
  // config (no typed imports) stays in the applied script.
  it('declares the springdoc plugin in the root plugins block and wires the export-openapi-java.gradle apply-from', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-public',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      generateContractTesting(config)
      const build = readFileSync(join(javaDir, 'build.gradle'), 'utf-8')
      expect(build).toMatch(/id 'org\.springdoc\.openapi-gradle-plugin' version '\d/)
      expect(build).toContain("apply from: 'config/export-openapi-java.gradle'")
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('export-openapi-java.gradle no longer contains a plugins {} block (apply-from would be withheld otherwise)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-public',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      generateContractTesting(config)
      const snippet = readFileSync(join(javaDir, 'config', 'export-openapi-java.gradle'), 'utf-8')
      expect(snippet).not.toMatch(/(?:^|\n)[ \t]*plugins\s*\{/)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('returns 3 files for rest-public + rust (diff test + exporter binary + policy)', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'rest-public',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(3)
      expect(existsSync(join(rustDir, 'tests', 'openapi_diff_test.rs'))).toBe(true)
      expect(existsSync(join(rustDir, 'src', 'bin', 'export_openapi.rs'))).toBe(true)
      expect(existsSync(join(rustDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('returns 3 files for rest-public + go (diff test + exporter binary + policy)', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        contractType: 'rest-public',
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(3)
      expect(existsSync(join(goDir, 'tests', 'openapi_diff_test.go'))).toBe(true)
      expect(existsSync(join(goDir, 'cmd', 'export-openapi', 'main.go'))).toBe(true)
      expect(existsSync(join(goDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('returns 3 files for rest-public + python (diff test + exporter + policy)', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        contractType: 'rest-public',
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(3)
      expect(existsSync(join(pyDir, 'tests', 'contract', 'test_openapi_diff.py'))).toBe(true)
      expect(existsSync(join(pyDir, 'export_openapi.py'))).toBe(true)
      expect(existsSync(join(pyDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  it('generates OpenApiDiffIT.java at fallback path for rest-public + java (no basePackage, count check)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'rest-public',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(3)
      expect(
        existsSync(join(javaDir, 'src', 'test', 'java', 'contracts', 'OpenApiDiffIT.java')),
      ).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // ─── graphql × all languages ──────────────────────────────────────────────

  it('returns 2 files for graphql + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'graphql',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(2)
  })

  it('generates src/test/contracts/graphql-inspector.test.ts for graphql + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'graphql',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'src', 'test', 'contracts', 'graphql-inspector.test.ts'))).toBe(
      true,
    )
  })

  it('returns 2 files for graphql + java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'graphql',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(2)
      expect(
        existsSync(join(javaDir, 'src', 'test', 'java', 'contracts', 'GraphqlSchemaTest.java')),
      ).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('returns 2 files for graphql + rust', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'graphql',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(2)
      expect(existsSync(join(rustDir, 'tests', 'graphql_schema_test.rs'))).toBe(true)
      expect(existsSync(join(rustDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('returns 2 files for graphql + go', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        contractType: 'graphql',
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(2)
      expect(existsSync(join(goDir, 'tests', 'graphql_schema_test.go'))).toBe(true)
      expect(existsSync(join(goDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('returns 2 files for graphql + python', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        contractType: 'graphql',
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(2)
      expect(existsSync(join(pyDir, 'tests', 'contract', 'test_graphql_schema.py'))).toBe(true)
      expect(existsSync(join(pyDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  // ─── grpc × all languages: 4 files each ──────────────────────────────────

  it('returns 4 files for grpc + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'grpc',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(4)
  })

  it('generates proto/buf.yaml for grpc + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'grpc',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'proto', 'buf.yaml'))).toBe(true)
  })

  it('generates proto/buf-breaking.yml for grpc + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'grpc',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'proto', 'buf-breaking.yml'))).toBe(true)
  })

  it('generates src/test/contracts/grpc-contract.test.ts for grpc + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'grpc',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'src', 'test', 'contracts', 'grpc-contract.test.ts'))).toBe(true)
  })

  it('returns 4 files for grpc + java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'grpc',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(4)
      expect(
        existsSync(join(javaDir, 'src', 'test', 'java', 'contracts', 'GrpcContractTest.java')),
      ).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('returns 4 files for grpc + rust', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'grpc',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(4)
      expect(existsSync(join(rustDir, 'tests', 'grpc_contract_test.rs'))).toBe(true)
      expect(existsSync(join(rustDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('returns 4 files for grpc + go', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        contractType: 'grpc',
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(4)
      expect(existsSync(join(goDir, 'tests', 'grpc_contract_test.go'))).toBe(true)
      expect(existsSync(join(goDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('returns 4 files for grpc + python', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        contractType: 'grpc',
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(4)
      expect(existsSync(join(pyDir, 'tests', 'contract', 'test_grpc_contract.py'))).toBe(true)
      expect(existsSync(join(pyDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  // ─── message-queue × all languages ───────────────────────────────────────

  it('returns 2 files for message-queue + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'message-queue',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    expect(generateContractTesting(config).files).toHaveLength(2)
  })

  it('generates src/test/contracts/schema-registry-check.ts for message-queue + typescript', () => {
    const config = makeConfig(dir, {
      contractType: 'message-queue',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'src', 'test', 'contracts', 'schema-registry-check.ts'))).toBe(true)
  })

  it('returns 2 files for message-queue + java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        contractType: 'message-queue',
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
        hasPublicApi: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(2)
      expect(
        existsSync(join(javaDir, 'src', 'test', 'java', 'contracts', 'SchemaRegistryCheckIT.java')),
      ).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('returns 2 files for message-queue + rust', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'message-queue',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(2)
      expect(existsSync(join(rustDir, 'tests', 'schema_registry_test.rs'))).toBe(true)
      expect(existsSync(join(rustDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('returns 2 files for message-queue + go', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        contractType: 'message-queue',
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(2)
      expect(existsSync(join(goDir, 'tests', 'schema_registry_test.go'))).toBe(true)
      expect(existsSync(join(goDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('returns 2 files for message-queue + python', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        contractType: 'message-queue',
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      const result = generateContractTesting(config)
      expect(result.files).toHaveLength(2)
      expect(existsSync(join(pyDir, 'tests', 'contract', 'test_schema_registry.py'))).toBe(true)
      expect(existsSync(join(pyDir, 'CONTRACTS_POLICY.md'))).toBe(true)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  // ─── Brownfield / skipIfExists (CANON-11) ────────────────────────────────

  it('skips CONTRACTS_POLICY.md when it already exists (brownfield)', () => {
    // Pre-write the file with sentinel content
    const policyPath = join(dir, 'CONTRACTS_POLICY.md')
    writeFileSync(policyPath, 'existing content', 'utf-8')

    const config = makeConfig(dir, {
      contractType: 'rest-owned',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    const result = generateContractTesting(config)

    // Policy file should be first in results
    const policyResult = result.files.find((f) => f.path === policyPath)
    expect(policyResult).toBeDefined()
    expect(policyResult!.action).toBe('skipped')

    // Content should be unchanged
    expect(readFileSync(policyPath, 'utf-8')).toBe('existing content')
  })

  it('skips language-specific file when it already exists (brownfield)', () => {
    const contractDir = join(dir, 'src', 'test', 'contracts')
    mkdirSync(contractDir, { recursive: true })
    const testPath = join(contractDir, 'pact-consumer.test.ts')
    writeFileSync(testPath, 'existing pact content', 'utf-8')

    const config = makeConfig(dir, {
      contractType: 'rest-owned',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    const result = generateContractTesting(config)

    const skippedResult = result.files.find((f) => f.path === testPath)
    expect(skippedResult).toBeDefined()
    expect(skippedResult!.action).toBe('skipped')

    // Content should be unchanged
    expect(readFileSync(testPath, 'utf-8')).toBe('existing pact content')
  })

  // ─── No cross-language file bleed ────────────────────────────────────────

  it('does not emit java files for typescript (rest-owned)', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-owned',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(
      existsSync(join(dir, 'src', 'test', 'java', 'contracts', 'PactVerificationIT.java')),
    ).toBe(false)
    expect(existsSync(join(dir, 'config', 'pact-deps.gradle'))).toBe(false)
  })

  it('does not emit typescript files for rust (rest-owned)', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
        hasPublicApi: true,
        acceptBetaTools: true,
      })
      generateContractTesting(config)
      expect(existsSync(join(rustDir, 'src', 'test', 'contracts', 'pact-consumer.test.ts'))).toBe(
        false,
      )
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('does not emit buf files for rest-owned', () => {
    const config = makeConfig(dir, {
      contractType: 'rest-owned',
      governanceLevel: 'L2',
      language: 'typescript',
      hasPublicApi: true,
    })
    generateContractTesting(config)
    expect(existsSync(join(dir, 'proto', 'buf.yaml'))).toBe(false)
    expect(existsSync(join(dir, 'proto', 'buf-breaking.yml'))).toBe(false)
  })

  // ─── #1348: --language multi without basePackage must not crash ────────────

  it('does not throw for language=multi when basePackage key is absent', () => {
    const multiDir = createTestProject('typescript')
    initGit(multiDir)
    try {
      const config = makeConfig(multiDir, {
        contractType: 'rest-owned',
        governanceLevel: 'L2',
        language: 'multi',
        hasPublicApi: true,
      }) as Record<string, unknown>
      // Match the real init path which omits the key entirely when unset.
      delete config['basePackage']
      let files: { path: string }[] = []
      expect(() => {
        files = generateContractTesting(config as never).files
      }).not.toThrow()
      // Java contract test is emitted for multi with its com.example fallback.
      const javaFile = files.find((f) => f.path.endsWith('PactVerificationIT.java'))
      expect(javaFile).toBeDefined()
      expect(readFileSync(javaFile!.path, 'utf-8')).toContain('package com.example.contracts;')
    } finally {
      cleanupTestProject(multiDir)
    }
  })
})
