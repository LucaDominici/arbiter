import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  it('returns empty files at L1 for a starter pipeline (no release → no mutation gate)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L1',
      buildTool: 'gradle',
      collaborationMode: 'trunk-solo', // L1 trunk-solo → starter
    })
    const result = generateMutation(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files at L2 for a starter pipeline', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L2',
      collaborationMode: 'trunk-solo', // L2 trunk-solo → starter
    })
    const result = generateMutation(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files at L1 when an explicit starter pipelineStyle suppresses the release', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L1',
      pipelineStyle: 'starter',
    })
    const result = generateMutation(config)
    expect(result.files).toHaveLength(0)
  })

  // #1543 — a non-starter release at L1/L2 enforces mutation as BLOCKING (#1505),
  // so the matching tool config MUST be generated or the fail-on-empty fallback fails.
  it('emits stryker.conf.json at L2 for a non-starter pipeline (peer-review L2 → standard)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L2',
      collaborationMode: 'peer-review', // L2 peer-review → standard (release emitted)
    })
    const result = generateMutation(config)
    const stryker = result.files.find((f) => f.path.endsWith('stryker.conf.json'))
    expect(stryker, 'stryker.conf.json not emitted for non-starter L2').toBeDefined()
    expect(existsSync(stryker!.path)).toBe(true)
  })

  it('emits stryker.conf.json at L1 for a non-starter pipeline (gated-review L1 → standard)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L1',
      collaborationMode: 'gated-review', // L1 gated-review → standard (release emitted)
    })
    const result = generateMutation(config)
    const stryker = result.files.find((f) => f.path.endsWith('stryker.conf.json'))
    expect(stryker, 'stryker.conf.json not emitted for non-starter L1').toBeDefined()
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

  it('does NOT emit pitest.gradle at L2 for a starter pipeline', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L2',
      buildTool: 'gradle',
      collaborationMode: 'trunk-solo', // L2 trunk-solo → starter (no release)
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

  it('does NOT emit stryker.conf.json at L2 for a starter pipeline', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L2',
      collaborationMode: 'trunk-solo', // L2 trunk-solo → starter (no release)
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

  it('returns empty files when acceptBetaTools=false at L3 (graceful skip, #294)', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      governanceLevel: 'L3',
      acceptBetaTools: false,
    })
    expect(generateMutation(config).files).toHaveLength(0)
  })

  it('returns empty files when acceptBetaTools not set at L3 (graceful skip, #294)', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      governanceLevel: 'L3',
    })
    expect(generateMutation(config).files).toHaveLength(0)
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

  it('returns empty files when acceptBetaTools=false at L3 (graceful skip, #294)', () => {
    const config = makeConfig(dir, {
      language: 'python',
      governanceLevel: 'L3',
      acceptBetaTools: false,
    })
    expect(generateMutation(config).files).toHaveLength(0)
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

  it('returns empty files for Go at L3 (graceful skip, #294)', () => {
    const config = makeConfig(dir, {
      language: 'go',
      governanceLevel: 'L3',
      acceptBetaTools: true,
    })
    expect(generateMutation(config).files).toHaveLength(0)
  })
})

// #1887-C: mutation/README.md.ejs was a fully-written template with zero
// consumer — no generator ever rendered it into docs/mutation/README.md, so
// every project got the per-stack pitest/stryker/cargo-mutants/mutmut configs
// with no single doc explaining setup + the threshold + how to opt out.
describe('generateMutation — docs/mutation/README.md (#1887-C)', () => {
  beforeEach(() => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
  })

  it('emits docs/mutation/README.md at L3 for a Java Gradle project', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L3',
      buildTool: 'gradle',
    })
    const result = generateMutation(config)
    const readme = result.files.find((f) => f.path.endsWith(join('mutation', 'README.md')))
    expect(readme, 'docs/mutation/README.md not emitted').toBeDefined()
    expect(existsSync(readme!.path)).toBe(true)
  })

  it('README.md points at gradle/pitest.gradle and the mutation threshold', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L3',
      buildTool: 'gradle',
    })
    const result = generateMutation(config)
    const readme = result.files.find((f) => f.path.endsWith(join('mutation', 'README.md')))
    const content = readFileSync(readme!.path, 'utf-8')
    expect(content).toContain("apply from: 'gradle/pitest.gradle'")
    expect(content).toContain('85% mutation score')
  })

  it('README.md points at TypeScript Stryker setup for a typescript project', () => {
    cleanupTestProject(dir)
    dir = createTestProject('unknown')
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L3',
    })
    const result = generateMutation(config)
    const readme = result.files.find((f) => f.path.endsWith(join('mutation', 'README.md')))
    const content = readFileSync(readme!.path, 'utf-8')
    expect(content).toContain('@stryker-mutator/core')
  })

  it('does NOT emit docs/mutation/README.md at L2 for a starter pipeline', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L2',
      buildTool: 'gradle',
      collaborationMode: 'trunk-solo',
    })
    const result = generateMutation(config)
    expect(result.files).toHaveLength(0)
  })
})
