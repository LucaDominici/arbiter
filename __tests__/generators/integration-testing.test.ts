import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateIntegrationTesting } from '../../src/generators/integration-testing.js'

describe('generateIntegrationTesting', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  // ─── Gate: hasDatabase=false → empty ────────────────────────────────────────

  it('returns empty when hasDatabase is false', () => {
    const config = makeConfig(dir, {
      hasDatabase: false,
      governanceLevel: 'L2',
      language: 'typescript',
    })
    expect(generateIntegrationTesting(config).files).toHaveLength(0)
  })

  it('returns empty when hasDatabase is false even with language java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: false,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // ─── Gate: L1 → empty (even with hasDatabase=true) ──────────────────────────

  it('returns empty when governanceLevel is L1 with hasDatabase=true', () => {
    const config = makeConfig(dir, {
      hasDatabase: true,
      governanceLevel: 'L1',
      language: 'typescript',
    })
    expect(generateIntegrationTesting(config).files).toHaveLength(0)
  })

  it('returns empty when governanceLevel is L1 for java with hasDatabase=true', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L1',
        language: 'java',
        buildTool: 'gradle',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // ─── TypeScript: 2 files at L2 ───────────────────────────────────────────────

  it('returns 2 files for typescript at L2 with hasDatabase=true', () => {
    const config = makeConfig(dir, {
      hasDatabase: true,
      governanceLevel: 'L2',
      language: 'typescript',
    })
    expect(generateIntegrationTesting(config).files).toHaveLength(2)
  })

  it('generates test-setup.ts for typescript', () => {
    const config = makeConfig(dir, {
      hasDatabase: true,
      governanceLevel: 'L2',
      language: 'typescript',
    })
    generateIntegrationTesting(config)
    expect(existsSync(join(dir, 'src', 'test', 'test-setup.ts'))).toBe(true)
  })

  it('generates eslint-no-fake-db.json for typescript', () => {
    const config = makeConfig(dir, {
      hasDatabase: true,
      governanceLevel: 'L2',
      language: 'typescript',
    })
    generateIntegrationTesting(config)
    expect(existsSync(join(dir, '.eslintrc-no-fake-db.json'))).toBe(true)
  })

  it('test-setup.ts contains PostgreSqlContainer', () => {
    const config = makeConfig(dir, {
      hasDatabase: true,
      governanceLevel: 'L2',
      language: 'typescript',
    })
    generateIntegrationTesting(config)
    const content = readFileSync(join(dir, 'src', 'test', 'test-setup.ts'), 'utf-8')
    expect(content).toContain('PostgreSqlContainer')
  })

  // ─── TypeScript: also passes at L3 ───────────────────────────────────────────

  it('returns 2 files for typescript at L3 with hasDatabase=true', () => {
    const config = makeConfig(dir, {
      hasDatabase: true,
      governanceLevel: 'L3',
      language: 'typescript',
    })
    expect(generateIntegrationTesting(config).files).toHaveLength(2)
  })

  // ─── Java: 3 files at L3 ─────────────────────────────────────────────────────

  it('returns 3 files for java at L3 with hasDatabase=true', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L3',
        language: 'java',
        buildTool: 'gradle',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(3)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // ─── Java: 3 files at L2 ─────────────────────────────────────────────────────

  it('returns 3 files for java at L2 with hasDatabase=true', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(3)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('generates AbstractIntegrationTest.java for java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      generateIntegrationTesting(config)
      expect(
        existsSync(join(javaDir, 'src', 'test', 'java', 'support', 'AbstractIntegrationTest.java')),
      ).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('generates NoH2ArchTest.java for java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      generateIntegrationTesting(config)
      expect(existsSync(join(javaDir, 'src', 'test', 'java', 'support', 'NoH2ArchTest.java'))).toBe(
        true,
      )
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('generates testcontainers-deps.gradle for java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      generateIntegrationTesting(config)
      expect(existsSync(join(javaDir, 'config', 'testcontainers-deps.gradle'))).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // #1887-F: config/testcontainers-deps.gradle was emitted but never wired into
  // the root build — same ghost class as #1886. No plugins{} block (pure deps),
  // so only apply(from=...) is needed.
  it('wires config/testcontainers-deps.gradle into the root build via apply(from=...)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      generateIntegrationTesting(config)
      const build = readFileSync(join(javaDir, 'build.gradle'), 'utf-8')
      expect(build).toContain("apply from: 'config/testcontainers-deps.gradle'")
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('does not crash when no Gradle build script exists yet', () => {
    const javaDir = createTestProject('typescript')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      expect(() => generateIntegrationTesting(config)).not.toThrow()
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('AbstractIntegrationTest.java contains @Testcontainers and PostgreSQLContainer', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      generateIntegrationTesting(config)
      const content = readFileSync(
        join(javaDir, 'src', 'test', 'java', 'support', 'AbstractIntegrationTest.java'),
        'utf-8',
      )
      expect(content).toContain('@Testcontainers')
      expect(content).toContain('PostgreSQLContainer')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('NoH2ArchTest.java contains org.h2', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      generateIntegrationTesting(config)
      const content = readFileSync(
        join(javaDir, 'src', 'test', 'java', 'support', 'NoH2ArchTest.java'),
        'utf-8',
      )
      expect(content).toContain('org.h2')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  // ─── Rust: 1 file at L3 ──────────────────────────────────────────────────────

  it('returns 1 file for rust at L3 with hasDatabase=true', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        hasDatabase: true,
        governanceLevel: 'L3',
        language: 'rust',
        buildTool: 'cargo',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(1)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  // ─── Rust: 1 file at L2 ──────────────────────────────────────────────────────

  it('returns 1 file for rust at L2 with hasDatabase=true', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(1)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('generates tests/db_fixture.rs for rust', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
      })
      generateIntegrationTesting(config)
      expect(existsSync(join(rustDir, 'tests', 'db_fixture.rs'))).toBe(true)
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  it('db_fixture.rs uses testcontainers (not sqlx/DATABASE_URL panic)', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    try {
      const config = makeConfig(rustDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'rust',
        buildTool: 'cargo',
      })
      generateIntegrationTesting(config)
      const content = readFileSync(join(rustDir, 'tests', 'db_fixture.rs'), 'utf-8')
      expect(content).toContain('testcontainers')
      expect(content).not.toContain('panic!("DATABASE_URL"')
    } finally {
      cleanupTestProject(rustDir)
    }
  })

  // ─── Go: 1 file at L3 ────────────────────────────────────────────────────────

  it('returns 1 file for go at L3 with hasDatabase=true', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        hasDatabase: true,
        governanceLevel: 'L3',
        language: 'go',
        buildTool: 'go',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(1)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  // ─── Go: 1 file at L2 ────────────────────────────────────────────────────────

  it('returns 1 file for go at L2 with hasDatabase=true', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(1)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('generates tests/main_test.go for go', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
      })
      generateIntegrationTesting(config)
      expect(existsSync(join(goDir, 'tests', 'main_test.go'))).toBe(true)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('main_test.go contains testcontainers or PostgresContainer', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    try {
      const config = makeConfig(goDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'go',
        buildTool: 'go',
      })
      generateIntegrationTesting(config)
      const content = readFileSync(join(goDir, 'tests', 'main_test.go'), 'utf-8')
      expect(content.includes('testcontainers') || content.includes('PostgresContainer')).toBe(true)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  // ─── Python: 1 file at L3 ────────────────────────────────────────────────────

  it('returns 1 file for python at L3 with hasDatabase=true', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        hasDatabase: true,
        governanceLevel: 'L3',
        language: 'python',
        buildTool: 'pip',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(1)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  // ─── Python: 1 file at L2 ────────────────────────────────────────────────────

  it('returns 1 file for python at L2 with hasDatabase=true', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(1)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  it('generates tests/conftest.py for python', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
      })
      generateIntegrationTesting(config)
      expect(existsSync(join(pyDir, 'tests', 'conftest.py'))).toBe(true)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  it('conftest.py contains PostgreSQLContainer', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
      })
      generateIntegrationTesting(config)
      const content = readFileSync(join(pyDir, 'tests', 'conftest.py'), 'utf-8')
      expect(content).toContain('PostgreSQLContainer')
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  // ─── Negative: no cross-language file bleed ────────────────────────────────

  it('does not emit java files for typescript', () => {
    const config = makeConfig(dir, {
      hasDatabase: true,
      governanceLevel: 'L2',
      language: 'typescript',
    })
    generateIntegrationTesting(config)
    expect(
      existsSync(join(dir, 'src', 'test', 'java', 'support', 'AbstractIntegrationTest.java')),
    ).toBe(false)
    expect(existsSync(join(dir, 'config', 'testcontainers-deps.gradle'))).toBe(false)
  })

  it('does not emit python files for java', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: true,
        governanceLevel: 'L2',
        language: 'java',
        buildTool: 'gradle',
      })
      generateIntegrationTesting(config)
      expect(existsSync(join(javaDir, 'tests', 'conftest.py'))).toBe(false)
    } finally {
      cleanupTestProject(javaDir)
    }
  })
})

describe('generateIntegrationTesting — DB-only scope (#487)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  // #487: This generator is intentionally DB-scoped. API-only L2 projects
  // (hasDatabase=false, hasPublicApi=true) must NOT receive PostgreSQL
  // scaffolding — every template here hardcodes PostgreSQLContainer.
  // API-only projects are covered by the separate `contract-testing` generator.
  it('returns 0 files for API-only L2 (hasDatabase=false, hasPublicApi=true)', () => {
    const config = makeConfig(dir, {
      hasDatabase: false,
      hasPublicApi: true,
      governanceLevel: 'L2',
      language: 'typescript',
    })
    expect(generateIntegrationTesting(config).files).toHaveLength(0)
  })

  it('returns 0 files for API-only L3 java (hasDatabase=false, hasPublicApi=true)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        hasDatabase: false,
        hasPublicApi: true,
        governanceLevel: 'L3',
        language: 'java',
        buildTool: 'gradle',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('returns 0 files for API-only python (hasDatabase=false, hasPublicApi=true)', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        hasDatabase: false,
        hasPublicApi: true,
        governanceLevel: 'L2',
        language: 'python',
        buildTool: 'pip',
      })
      expect(generateIntegrationTesting(config).files).toHaveLength(0)
    } finally {
      cleanupTestProject(pyDir)
    }
  })
})

describe('generateIntegrationTesting — F10 Rust Cargo.toml dev-dep (#369)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject('rust')
    initGit(dir)
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('appends testcontainers dev-dep to Cargo.toml for Rust+L2', () => {
    const config = makeConfig(dir, {
      hasDatabase: true,
      governanceLevel: 'L2',
      language: 'rust',
      buildTool: 'cargo',
    })
    generateIntegrationTesting(config)
    const cargo = readFileSync(join(dir, 'Cargo.toml'), 'utf-8')
    expect(cargo).toContain('[dev-dependencies]')
    expect(cargo).toContain('testcontainers')
  })

  it('running twice does not duplicate the dev-dep (idempotent)', () => {
    const config = makeConfig(dir, {
      hasDatabase: true,
      governanceLevel: 'L2',
      language: 'rust',
      buildTool: 'cargo',
    })
    generateIntegrationTesting(config)
    generateIntegrationTesting(config)
    const cargo = readFileSync(join(dir, 'Cargo.toml'), 'utf-8')
    const matches = cargo.match(/testcontainers/g) ?? []
    expect(matches.length).toBe(1)
  })
})
