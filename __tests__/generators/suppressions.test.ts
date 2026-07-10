import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSuppressions } from '../../src/generators/suppressions.js'

const EXPECTED_FILES = [
  join('suppressions', '.gitleaksignore'),
  join('suppressions', 'pii-allowlist.json'),
  join('suppressions', 'suppressions-schema.json'),
  join('scripts', 'check-suppressions.mjs'),
]

describe('generateSuppressions', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits check-inline-suppressions.mjs even when enableSuppressions is false (#242)', () => {
    const config = makeConfig(dir, { enableSuppressions: false })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('check-inline-suppressions.mjs'))).toBe(true)
  })

  it('emits check-inline-suppressions.mjs when enableSuppressions is true (#242)', () => {
    const config = makeConfig(dir, { enableSuppressions: true })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('check-inline-suppressions.mjs'))).toBe(true)
  })

  it('returns only inline-suppressions script when enableSuppressions is false (#242)', () => {
    const config = makeConfig(dir, { enableSuppressions: false })
    expect(generateSuppressions(config).files).toHaveLength(1)
  })

  it('generates 6 files when enableSuppressions is true for non-Java (#242 #292 #1737, ADR-104)', () => {
    // 5 base files (dependency-check-suppressions.xml removed, ADR-104/R-06) +
    // consumer-audit-allowlist.json — makeConfig's defaults (archetype:'library',
    // language:'typescript', governanceLevel:'L2') satisfy the #1737
    // published-library guard.
    const config = makeConfig(dir, { enableSuppressions: true })
    const result = generateSuppressions(config)
    expect(result.files).toHaveLength(6)
  })

  for (const relPath of EXPECTED_FILES) {
    it(`generates ${relPath}`, () => {
      const config = makeConfig(dir, { enableSuppressions: true })
      generateSuppressions(config)
      expect(existsSync(join(dir, relPath))).toBe(true)
    })
  }

  it('does NOT generate suppressions/dependency-check-suppressions.xml (ADR-104, R-06)', () => {
    const config = makeConfig(dir, { enableSuppressions: true })
    generateSuppressions(config)
    expect(existsSync(join(dir, 'suppressions', 'dependency-check-suppressions.xml'))).toBe(false)
  })

  for (const lang of ['typescript', 'rust', 'go', 'python'] as const) {
    // typescript gets a 6th file (consumer-audit-allowlist.json, #1737 — archetype
    // stays the default 'library' throughout this loop) — every other language is
    // excluded by the published-library-TypeScript guard and stays at 5.
    const expectedCount = lang === 'typescript' ? 6 : 5
    it(`generates ${expectedCount} files for ${lang} (#292 — archunit-baseline.json is Java-only)`, () => {
      const loopDir = createTestProject(lang)
      initGit(loopDir)
      try {
        const config = makeConfig(loopDir, {
          language: lang,
          enableSuppressions: true,
        })
        const result = generateSuppressions(config)
        expect(result.files).toHaveLength(expectedCount)
      } finally {
        cleanupTestProject(loopDir)
      }
    })
  }

  it('generates 7 files for java (#292 — archunit-baseline.json + .trivyignore, ADR-104)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        enableSuppressions: true,
      })
      const result = generateSuppressions(config)
      expect(result.files).toHaveLength(7)
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('does NOT emit archunit-baseline.json for non-Java (#292)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('archunit-baseline.json'))).toBe(false)
  })

  it('emits archunit-baseline.json for Java (#292)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        enableSuppressions: true,
      })
      const result = generateSuppressions(config)
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('archunit-baseline.json'))).toBe(true)
    } finally {
      cleanupTestProject(javaDir)
    }
  })
})

describe('generateSuppressions — .trivyignore at root (#208, ADR-104)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('java')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits .trivyignore at ROOT for Java L2 (R-04) and NOT owasp-suppressions.xml (R-05)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L2',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('owasp-suppressions.xml'))).toBe(false)
    expect(paths.some((p) => p === join(dir, '.trivyignore'))).toBe(true)
  })

  it('emits .trivyignore at ROOT for Kotlin L2', () => {
    const kotlinDir = createTestProject('kotlin')
    initGit(kotlinDir)
    try {
      const config = makeConfig(kotlinDir, {
        language: 'kotlin',
        governanceLevel: 'L2',
        enableSuppressions: true,
      })
      const result = generateSuppressions(config)
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p === join(kotlinDir, '.trivyignore'))).toBe(true)
    } finally {
      cleanupTestProject(kotlinDir)
    }
  })

  it('does NOT emit .trivyignore for a non-service TypeScript library at L2', () => {
    const tsDir = createTestProject('typescript')
    initGit(tsDir)
    try {
      const config = makeConfig(tsDir, {
        language: 'typescript',
        archetype: 'library',
        governanceLevel: 'L2',
        enableSuppressions: true,
      })
      const result = generateSuppressions(config)
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('.trivyignore'))).toBe(false)
    } finally {
      cleanupTestProject(tsDir)
    }
  })

  it('emits .trivyignore for a TypeScript SERVICE archetype (R-04 — container-scan steps reference it for every language)', () => {
    const tsDir = createTestProject('typescript')
    initGit(tsDir)
    try {
      const config = makeConfig(tsDir, {
        language: 'typescript',
        archetype: 'backend-web-db',
        governanceLevel: 'L2',
        enableSuppressions: true,
      })
      const result = generateSuppressions(config)
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p === join(tsDir, '.trivyignore'))).toBe(true)
    } finally {
      cleanupTestProject(tsDir)
    }
  })

  it('emits .trivyignore at L1 for Java too (R-04 — scope no longer L2+-gated)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L1',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p === join(dir, '.trivyignore'))).toBe(true)
  })

  it('total files = 7 for Java L2 with enableSuppressions (ADR-104)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L2',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    expect(result.files).toHaveLength(7)
  })

  it('skipIfExists on .trivyignore (CANON-11)', () => {
    const target = join(dir, '.trivyignore')
    writeFileSync(target, 'PREEXISTING')
    generateSuppressions(
      makeConfig(dir, {
        language: 'java',
        governanceLevel: 'L2',
        enableSuppressions: true,
      }),
    )
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateSuppressions — consumer-audit allowlist (#1737)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits consumer-audit-allowlist.json for a published TypeScript library at L2', () => {
    const config = makeConfig(dir, {
      archetype: 'library',
      language: 'typescript',
      governanceLevel: 'L2',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('consumer-audit-allowlist.json'))).toBe(true)
  })

  it('does NOT emit consumer-audit-allowlist.json for a non-library archetype', () => {
    const config = makeConfig(dir, {
      archetype: 'cli',
      language: 'typescript',
      governanceLevel: 'L2',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('consumer-audit-allowlist.json'))).toBe(false)
  })

  it('does NOT emit consumer-audit-allowlist.json at L1 for a TypeScript library', () => {
    const config = makeConfig(dir, {
      archetype: 'library',
      language: 'typescript',
      governanceLevel: 'L1',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('consumer-audit-allowlist.json'))).toBe(false)
  })

  it('does NOT emit consumer-audit-allowlist.json for a non-TypeScript library', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    try {
      const config = makeConfig(pyDir, {
        archetype: 'library',
        language: 'python',
        governanceLevel: 'L2',
        enableSuppressions: true,
      })
      const result = generateSuppressions(config)
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('consumer-audit-allowlist.json'))).toBe(false)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  it('skipIfExists on consumer-audit-allowlist.json (CANON-11 — never clobber a live disposition entry)', () => {
    const suppressionsDir = join(dir, 'suppressions')
    mkdirSync(suppressionsDir, { recursive: true })
    const target = join(suppressionsDir, 'consumer-audit-allowlist.json')
    writeFileSync(target, 'PREEXISTING')
    generateSuppressions(
      makeConfig(dir, {
        archetype: 'library',
        language: 'typescript',
        governanceLevel: 'L2',
        enableSuppressions: true,
      }),
    )
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})
