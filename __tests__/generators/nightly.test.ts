import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateNightly } from '../../src/generators/nightly.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('unknown')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateNightly — governance level gate', () => {
  it('returns empty files at L1', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files at L2', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(result.files).toHaveLength(0)
  })
})

describe('generateNightly — L3 emits expected files', () => {
  it('emits exactly 4 files at L3', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(result.files).toHaveLength(4)
  })

  it('emits nightly.yml', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    expect(f, 'nightly.yml not found').toBeDefined()
    expect(existsSync(f!.path)).toBe(true)
  })

  it('emits evidence-collect.mjs', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('evidence-collect.mjs'))
    expect(f, 'evidence-collect.mjs not found').toBeDefined()
    expect(existsSync(f!.path)).toBe(true)
  })

  it('emits ci-classify-changes.mjs', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('ci-classify-changes.mjs'))
    expect(f, 'ci-classify-changes.mjs not found').toBeDefined()
    expect(existsSync(f!.path)).toBe(true)
  })

  it('seeds .evidence/.gitkeep', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('.gitkeep'))
    expect(f, '.evidence/.gitkeep not found').toBeDefined()
    expect(existsSync(f!.path)).toBe(true)
  })

  it('nightly.yml has cron schedule at 02:00 UTC', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('cron:')
    expect(content).toContain('0 2 * * *')
  })

  it('nightly.yml contains trivy deep scan', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content.toLowerCase()).toContain('trivy')
  })

  it('nightly.yml contains k6 load test', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('k6')
  })

  it('nightly.yml uploads artifacts', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('upload-artifact')
  })

  it('evidence-collect.mjs produces obs_gate', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('evidence-collect.mjs'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('obs_gate')
  })

  it('evidence-collect.mjs produces SUMMARY.json', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('evidence-collect.mjs'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('SUMMARY.json')
  })

  it('ci-classify-changes.mjs emits docs_only flag', () => {
    const result = generateNightly(makeConfig(dir, { governanceLevel: 'L3' }))
    const f = result.files.find((f) => f.path.endsWith('ci-classify-changes.mjs'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('docs_only')
  })
})

describe('generateNightly — TypeScript L3 mutation', () => {
  it('nightly.yml contains stryker for typescript', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L3',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('stryker')
  })
})

describe('generateNightly — Java L3 mutation', () => {
  beforeEach(() => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
  })

  it('nightly.yml contains pitest for java', () => {
    const config = makeConfig(dir, {
      language: 'java',
      governanceLevel: 'L3',
      buildTool: 'gradle',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('pitest')
  })
})

describe('generateNightly — Rust L3 mutation', () => {
  beforeEach(() => {
    cleanupTestProject(dir)
    dir = createTestProject('rust')
  })

  it('nightly.yml contains cargo-mutants for rust', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      governanceLevel: 'L3',
      acceptBetaTools: true,
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('mutants')
  })
})

describe('generateNightly — Python L3 mutation', () => {
  beforeEach(() => {
    cleanupTestProject(dir)
    dir = createTestProject('python')
  })

  it('nightly.yml contains mutmut for python', () => {
    const config = makeConfig(dir, {
      language: 'python',
      governanceLevel: 'L3',
      acceptBetaTools: true,
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('mutmut')
  })
})

describe('generateNightly — SBOM job (#193)', () => {
  it('nightly.yml contains sbom job for TypeScript L3', () => {
    const config = makeConfig(createTestProject('typescript'), {
      language: 'typescript',
      governanceLevel: 'L3',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('sbom')
    expect(content).toContain('cyclonedx')
  })

  it('nightly.yml contains npm sbom command for TypeScript L3', () => {
    const config = makeConfig(createTestProject('typescript'), {
      language: 'typescript',
      governanceLevel: 'L3',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('npm sbom')
  })

  it('nightly.yml evidence-collect does not include sbom for Go', () => {
    const config = makeConfig(createTestProject('go'), {
      language: 'go',
      buildTool: 'go',
      governanceLevel: 'L3',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    const evidenceCollect = content.split('evidence-collect:')[1] ?? ''
    expect(evidenceCollect).not.toContain('sbom')
  })

  it('nightly.yml does not contain sbom job for Go', () => {
    const config = makeConfig(createTestProject('go'), {
      language: 'go',
      buildTool: 'go',
      governanceLevel: 'L3',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).not.toContain('SBOM Generation')
  })

  it('nightly.yml contains cyclonedxBom for Java Gradle', () => {
    const config = makeConfig(createTestProject('java'), {
      language: 'java',
      buildTool: 'gradle',
      governanceLevel: 'L3',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('cyclonedxBom')
  })

  it('nightly.yml contains cyclonedx-maven-plugin for Java Maven', () => {
    const config = makeConfig(createTestProject('java'), {
      language: 'java',
      buildTool: 'maven',
      governanceLevel: 'L3',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('cyclonedx-maven-plugin')
  })

  it('nightly.yml contains cargo cyclonedx for Rust', () => {
    const config = makeConfig(createTestProject('rust'), {
      language: 'rust',
      buildTool: 'cargo',
      governanceLevel: 'L3',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('cargo cyclonedx')
  })

  it('nightly.yml contains cyclonedx-py for Python', () => {
    const config = makeConfig(createTestProject('python'), {
      language: 'python',
      buildTool: 'pip',
      governanceLevel: 'L3',
    })
    const result = generateNightly(config)
    const f = result.files.find((f) => f.path.endsWith('nightly.yml'))
    const content = readFileSync(f!.path, 'utf-8')
    expect(content).toContain('cyclonedx-py')
  })
})
