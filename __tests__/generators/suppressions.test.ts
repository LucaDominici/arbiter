import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSuppressions } from '../../src/generators/suppressions.js'

const EXPECTED_FILES = [
  join('suppressions', 'dependency-check-suppressions.xml'),
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

  it('generates 7 files when enableSuppressions is true for non-Java (#242 #292 #1737)', () => {
    // 6 base files + consumer-audit-allowlist.json — makeConfig's defaults
    // (archetype:'library', language:'typescript', governanceLevel:'L2') satisfy
    // the #1737 published-library guard.
    const config = makeConfig(dir, { enableSuppressions: true })
    const result = generateSuppressions(config)
    expect(result.files).toHaveLength(7)
  })

  for (const relPath of EXPECTED_FILES) {
    it(`generates ${relPath}`, () => {
      const config = makeConfig(dir, { enableSuppressions: true })
      generateSuppressions(config)
      expect(existsSync(join(dir, relPath))).toBe(true)
    })
  }

  for (const lang of ['typescript', 'rust', 'go', 'python'] as const) {
    // typescript gets a 7th file (consumer-audit-allowlist.json, #1737 — archetype
    // stays the default 'library' throughout this loop) — every other language is
    // excluded by the published-library-TypeScript guard and stays at 6.
    const expectedCount = lang === 'typescript' ? 7 : 6
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

  it('generates 9 files for java (#292 — archunit-baseline.json included)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        enableSuppressions: true,
      })
      const result = generateSuppressions(config)
      expect(result.files).toHaveLength(9)
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

describe('generateSuppressions — owasp + trivyignore (#208)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('java')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits owasp-suppressions.xml + .trivyignore for Java L2', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L2',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('owasp-suppressions.xml'))).toBe(true)
    expect(paths.some((p) => p.endsWith('.trivyignore'))).toBe(true)
  })

  it('emits owasp-suppressions.xml + .trivyignore for Kotlin L2', () => {
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
      expect(paths.some((p) => p.endsWith('owasp-suppressions.xml'))).toBe(true)
      expect(paths.some((p) => p.endsWith('.trivyignore'))).toBe(true)
    } finally {
      cleanupTestProject(kotlinDir)
    }
  })

  it('does NOT emit owasp-suppressions.xml for TypeScript L2', () => {
    const tsDir = createTestProject('typescript')
    initGit(tsDir)
    try {
      const config = makeConfig(tsDir, {
        language: 'typescript',
        governanceLevel: 'L2',
        enableSuppressions: true,
      })
      const result = generateSuppressions(config)
      const paths = result.files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith('owasp-suppressions.xml'))).toBe(false)
    } finally {
      cleanupTestProject(tsDir)
    }
  })

  it('does NOT emit .trivyignore for TypeScript L2', () => {
    const tsDir = createTestProject('typescript')
    initGit(tsDir)
    try {
      const config = makeConfig(tsDir, {
        language: 'typescript',
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

  it('does NOT emit owasp-suppressions.xml at L1 for Java', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L1',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('owasp-suppressions.xml'))).toBe(false)
  })

  it('total files = 9 for Java L2 with enableSuppressions', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L2',
      enableSuppressions: true,
    })
    const result = generateSuppressions(config)
    expect(result.files).toHaveLength(9)
  })

  it('skipIfExists on owasp-suppressions.xml (CANON-11)', () => {
    const suppressionsDir = join(dir, 'suppressions')
    mkdirSync(suppressionsDir, { recursive: true })
    const target = join(suppressionsDir, 'owasp-suppressions.xml')
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

  it('skipIfExists on .trivyignore (CANON-11)', () => {
    const suppressionsDir = join(dir, 'suppressions')
    mkdirSync(suppressionsDir, { recursive: true })
    const target = join(suppressionsDir, '.trivyignore')
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
