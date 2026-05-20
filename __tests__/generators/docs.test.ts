import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateDocs } from '../../src/generators/docs.js'
import { makeConfig } from '../helpers.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-docs-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('generateDocs — ADR template (#192)', () => {
  it('emits ADR-000_template.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'adr', 'ADR-000_template.md'))).toBe(true)
  })

  it('emits ADR-000_template.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'adr', 'ADR-000_template.md'))).toBe(true)
  })

  it('does not emit ADR template at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'adr', 'ADR-000_template.md'))).toBe(false)
  })
})

describe('generateDocs — SECURE_CODING_CHECKLIST (#203)', () => {
  it('emits SECURE_CODING_CHECKLIST.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'SECURE_CODING_CHECKLIST.md'))).toBe(true)
  })

  it('emits SECURE_CODING_CHECKLIST.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'SECURE_CODING_CHECKLIST.md'))).toBe(true)
  })

  it('does not emit SECURE_CODING_CHECKLIST.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'SECURE_CODING_CHECKLIST.md'))).toBe(false)
  })
})

describe('generateDocs — CODING_STANDARDS (#206)', () => {
  it('emits CODING_STANDARDS.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'CODING_STANDARDS.md'))).toBe(true)
  })

  it('emits CODING_STANDARDS.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'CODING_STANDARDS.md'))).toBe(true)
  })

  it('does not emit CODING_STANDARDS.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'CODING_STANDARDS.md'))).toBe(false)
  })

  it('skipIfExists on docs/CODING_STANDARDS.md (#206, CANON-11)', () => {
    const docsDir = join(dir, 'docs')
    mkdirSync(docsDir, { recursive: true })
    const target = join(docsDir, 'CODING_STANDARDS.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — MASTER_TEST_PLAN (#209)', () => {
  it('emits MASTER_TEST_PLAN.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'MASTER_TEST_PLAN.md'))).toBe(true)
  })

  it('emits MASTER_TEST_PLAN.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'MASTER_TEST_PLAN.md'))).toBe(true)
  })

  it('does not emit MASTER_TEST_PLAN.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'MASTER_TEST_PLAN.md'))).toBe(false)
  })

  it('skipIfExists on docs/MASTER_TEST_PLAN.md (#209, CANON-11)', () => {
    const docsDir = join(dir, 'docs')
    mkdirSync(docsDir, { recursive: true })
    const target = join(docsDir, 'MASTER_TEST_PLAN.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — ISO27001_ANNEX_A (#217)', () => {
  it('emits docs/SECURITY/ISO27001_ANNEX_A.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'ISO27001_ANNEX_A.md'))).toBe(true)
  })

  it('does not emit ISO27001_ANNEX_A.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'ISO27001_ANNEX_A.md'))).toBe(false)
  })

  it('does not emit ISO27001_ANNEX_A.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'ISO27001_ANNEX_A.md'))).toBe(false)
  })
})

describe('generateDocs — POST_MERGE_REVIEW_TEMPLATE (#218)', () => {
  it('emits docs/testing/POST_MERGE_REVIEW_TEMPLATE.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'testing', 'POST_MERGE_REVIEW_TEMPLATE.md'))).toBe(true)
  })

  it('emits docs/testing/POST_MERGE_REVIEW_TEMPLATE.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'testing', 'POST_MERGE_REVIEW_TEMPLATE.md'))).toBe(true)
  })

  it('does not emit POST_MERGE_REVIEW_TEMPLATE.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'testing', 'POST_MERGE_REVIEW_TEMPLATE.md'))).toBe(false)
  })
})

describe('generateDocs — runbooks scaffold (#897)', () => {
  it('emits docs/runbooks/rollback.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'rollback.md'))).toBe(true)
  })

  it('emits docs/runbooks/troubleshooting.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'troubleshooting.md'))).toBe(true)
  })

  it('emits docs/runbooks/prod-checklist.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'prod-checklist.md'))).toBe(true)
  })

  it('emits docs/runbooks/deployment.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'deployment.md'))).toBe(true)
  })

  it('emits runbooks at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'runbooks', 'rollback.md'))).toBe(true)
  })

  it('does not emit runbooks at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'runbooks'))).toBe(false)
  })

  it('skipIfExists on docs/runbooks/rollback.md (#897, CANON-11)', () => {
    const runbooksDir = join(dir, 'docs', 'runbooks')
    mkdirSync(runbooksDir, { recursive: true })
    const target = join(runbooksDir, 'rollback.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — docs/security/ scaffold (#897)', () => {
  it('emits docs/security/STRIDE.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'security', 'STRIDE.md'))).toBe(true)
  })

  it('emits docs/security/STRIDE.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'security', 'STRIDE.md'))).toBe(true)
  })

  it('does not emit docs/security/STRIDE.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'security', 'STRIDE.md'))).toBe(false)
  })

  it('emits docs/security/RISK_ASSESSMENT.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'security', 'RISK_ASSESSMENT.md'))).toBe(true)
  })

  it('does not emit docs/security/RISK_ASSESSMENT.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'security', 'RISK_ASSESSMENT.md'))).toBe(false)
  })

  it('does not emit docs/security/RISK_ASSESSMENT.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'security', 'RISK_ASSESSMENT.md'))).toBe(false)
  })

  it('skipIfExists on docs/security/STRIDE.md (#897, CANON-11)', () => {
    const secDir = join(dir, 'docs', 'security')
    mkdirSync(secDir, { recursive: true })
    const target = join(secDir, 'STRIDE.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})

describe('generateDocs — COMMANDS.md CLI catalog (#728)', () => {
  it('emits docs/COMMANDS.md at L2', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'docs', 'COMMANDS.md'))).toBe(true)
  })

  it('emits docs/COMMANDS.md at L3', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'COMMANDS.md'))).toBe(true)
  })

  it('does not emit docs/COMMANDS.md at L1', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'COMMANDS.md'))).toBe(false)
  })

  it('skipIfExists on docs/COMMANDS.md (#728, CANON-11)', () => {
    const docsDir = join(dir, 'docs')
    mkdirSync(docsDir, { recursive: true })
    const target = join(docsDir, 'COMMANDS.md')
    writeFileSync(target, 'PREEXISTING')
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })

  it('COMMANDS.md contains project build/test/lint/format commands', () => {
    generateDocs(
      makeConfig(dir, {
        governanceLevel: 'L2',
        buildCommand: 'npm run build',
        testCommand: 'npm test',
        lintCommand: 'npm run lint',
        formatCommand: 'npx prettier --check .',
      }),
    )
    const content = readFileSync(join(dir, 'docs', 'COMMANDS.md'), 'utf-8')
    expect(content).toContain('npm run build')
    expect(content).toContain('npm test')
    expect(content).toContain('npm run lint')
    expect(content).toContain('npx prettier --check .')
  })

  it('COMMANDS.md contains gate commands', () => {
    generateDocs(makeConfig(dir, { governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'docs', 'COMMANDS.md'), 'utf-8')
    expect(content).toContain('check-all.mjs')
  })
})
