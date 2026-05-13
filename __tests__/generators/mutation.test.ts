import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateMutation } from '../../src/generators/mutation.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('unknown')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateMutation — governance level gate', () => {
  it('returns empty files at L1 for any language', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L1',
      buildTool: 'gradle',
    })
    const result = generateMutation(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files at L2 for any language', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L2',
    })
    const result = generateMutation(config)
    expect(result.files).toHaveLength(0)
  })
})

describe('generateMutation — Java L3', () => {
  beforeEach(() => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
  })

  it('emits pitest.gradle at L3 for Gradle build', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L3',
      buildTool: 'gradle',
    })
    const result = generateMutation(config)
    const pitestFile = result.files.find((f) => f.path.endsWith('pitest.gradle'))
    expect(pitestFile, 'pitest.gradle not found').toBeDefined()
    expect(existsSync(pitestFile!.path)).toBe(true)
  })

  it('pitest.gradle contains 85% mutation threshold', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L3',
      buildTool: 'gradle',
    })
    const result = generateMutation(config)
    const pitestFile = result.files.find((f) => f.path.endsWith('pitest.gradle'))
    const content = readFileSync(pitestFile!.path, 'utf-8')
    expect(content).toContain('85')
    expect(content).toContain('pitest')
  })

  it('emits maven guide at L3 for Maven build', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L3',
      buildTool: 'maven',
    })
    const result = generateMutation(config)
    const mavenFile = result.files.find(
      (f) => f.path.includes('mutation') && f.path.endsWith('.md'),
    )
    expect(mavenFile, 'Maven mutation guide not found').toBeDefined()
    expect(existsSync(mavenFile!.path)).toBe(true)
  })

  it('does NOT emit pitest.gradle at L2', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L2',
      buildTool: 'gradle',
    })
    const result = generateMutation(config)
    const pitestFile = result.files.find((f) => f.path.endsWith('pitest.gradle'))
    expect(pitestFile).toBeUndefined()
  })
})

describe('generateMutation — TypeScript L3', () => {
  beforeEach(() => {
    cleanupTestProject(dir)
    dir = createTestProject('typescript')
  })

  it('emits stryker.conf.json at L3', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L3',
    })
    const result = generateMutation(config)
    const strykerFile = result.files.find((f) => f.path.endsWith('stryker.conf.json'))
    expect(strykerFile, 'stryker.conf.json not found').toBeDefined()
    expect(existsSync(strykerFile!.path)).toBe(true)
  })

  it('stryker.conf.json has break threshold of 85', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L3',
    })
    const result = generateMutation(config)
    const strykerFile = result.files.find((f) => f.path.endsWith('stryker.conf.json'))
    const content = readFileSync(strykerFile!.path, 'utf-8')
    expect(content).toContain('85')
    expect(content).toContain('vitest')
  })

  it('does NOT emit stryker.conf.json at L2', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L2',
    })
    const result = generateMutation(config)
    const strykerFile = result.files.find((f) => f.path.endsWith('stryker.conf.json'))
    expect(strykerFile).toBeUndefined()
  })
})

describe('generateMutation — Rust L3 beta', () => {
  beforeEach(() => {
    cleanupTestProject(dir)
    dir = createTestProject('rust')
  })

  it('emits cargo-mutants.toml when acceptBetaTools=true at L3', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      governanceLevel: 'L3',
      acceptBetaTools: true,
    })
    const result = generateMutation(config)
    const mutantsFile = result.files.find((f) => f.path.endsWith('cargo-mutants.toml'))
    expect(mutantsFile, 'cargo-mutants.toml not found').toBeDefined()
    expect(existsSync(mutantsFile!.path)).toBe(true)
  })

  it('throws beta error when acceptBetaTools=false at L3', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      governanceLevel: 'L3',
      acceptBetaTools: false,
    })
    expect(() => generateMutation(config)).toThrow(/beta/i)
  })

  it('throws beta error when acceptBetaTools not set at L3', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      governanceLevel: 'L3',
    })
    expect(() => generateMutation(config)).toThrow(/beta/i)
  })

  it('emits parse-mutants.mjs alongside cargo-mutants.toml', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      governanceLevel: 'L3',
      acceptBetaTools: true,
    })
    const result = generateMutation(config)
    const parseFile = result.files.find((f) => f.path.endsWith('parse-mutants.mjs'))
    expect(parseFile, 'parse-mutants.mjs not found').toBeDefined()
    expect(existsSync(parseFile!.path)).toBe(true)
  })
})

describe('generateMutation — Python L3 beta', () => {
  beforeEach(() => {
    cleanupTestProject(dir)
    dir = createTestProject('python')
  })

  it('emits mutmut-config.toml when acceptBetaTools=true at L3', () => {
    const config = makeConfig(dir, {
      language: 'python',
      governanceLevel: 'L3',
      acceptBetaTools: true,
    })
    const result = generateMutation(config)
    const mutmutFile = result.files.find((f) => f.path.endsWith('mutmut-config.toml'))
    expect(mutmutFile, 'mutmut-config.toml not found').toBeDefined()
    expect(existsSync(mutmutFile!.path)).toBe(true)
  })

  it('throws beta error when acceptBetaTools=false at L3', () => {
    const config = makeConfig(dir, {
      language: 'python',
      governanceLevel: 'L3',
      acceptBetaTools: false,
    })
    expect(() => generateMutation(config)).toThrow(/beta/i)
  })

  it('emits parse-mutmut.py alongside mutmut-config.toml', () => {
    const config = makeConfig(dir, {
      language: 'python',
      governanceLevel: 'L3',
      acceptBetaTools: true,
    })
    const result = generateMutation(config)
    const parseFile = result.files.find((f) => f.path.endsWith('parse-mutmut.py'))
    expect(parseFile, 'parse-mutmut.py not found').toBeDefined()
    expect(existsSync(parseFile!.path)).toBe(true)
  })
})

describe('generateMutation — Go L3 (blocked)', () => {
  beforeEach(() => {
    cleanupTestProject(dir)
    dir = createTestProject('go')
  })

  it('throws unsafe error for Go at L3', () => {
    const config = makeConfig(dir, {
      language: 'go',
      governanceLevel: 'L3',
      acceptBetaTools: true,
    })
    expect(() => generateMutation(config)).toThrow(/unsafe|unavailable/i)
  })
})
