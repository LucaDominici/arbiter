import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateStrideEnforcement } from '../../src/generators/stride-enforcement.js'

// ─── Generator tests ─────────────────────────────────────────────────────────

describe('generateStrideEnforcement', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates 3 files at L2 (default)', () => {
    const config = makeConfig(dir)
    expect(generateStrideEnforcement(config).files).toHaveLength(3)
  })

  it('generates 4 files at L3', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    expect(generateStrideEnforcement(config).files).toHaveLength(4)
  })

  it('generates docs/SECURITY/RISK_ASSESSMENT.md at L3', () => {
    generateStrideEnforcement(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'RISK_ASSESSMENT.md'))).toBe(true)
  })

  it('does NOT generate RISK_ASSESSMENT.md at L1', () => {
    generateStrideEnforcement(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'RISK_ASSESSMENT.md'))).toBe(false)
  })

  it('does NOT generate RISK_ASSESSMENT.md at L2', () => {
    generateStrideEnforcement(makeConfig(dir))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'RISK_ASSESSMENT.md'))).toBe(false)
  })

  it('skipIfExists on RISK_ASSESSMENT.md (CANON-11)', () => {
    // Pre-write a file to simulate existing content
    const riskPath = join(dir, 'docs', 'SECURITY', 'RISK_ASSESSMENT.md')
    mkdirSync(join(dir, 'docs', 'SECURITY'), { recursive: true })
    writeFileSync(riskPath, 'EXISTING')
    // Run generator at L3
    const result = generateStrideEnforcement(makeConfig(dir, { governanceLevel: 'L3' }))
    const riskFile = result.files.find((f) => f.path.endsWith('RISK_ASSESSMENT.md'))
    expect(riskFile?.action).toBe('skipped')
    expect(readFileSync(riskPath, 'utf-8')).toBe('EXISTING')
  })

  it('generates docs/SECURITY/STRIDE.md', () => {
    generateStrideEnforcement(makeConfig(dir))
    expect(existsSync(join(dir, 'docs', 'SECURITY', 'STRIDE.md'))).toBe(true)
  })

  it('generates docs/GOVERNANCE/RACI.md', () => {
    generateStrideEnforcement(makeConfig(dir))
    expect(existsSync(join(dir, 'docs', 'GOVERNANCE', 'RACI.md'))).toBe(true)
  })

  it('generates scripts/check-stride-traceability.mjs', () => {
    generateStrideEnforcement(makeConfig(dir))
    expect(existsSync(join(dir, 'scripts', 'check-stride-traceability.mjs'))).toBe(true)
  })

  it('STRIDE.md is a skeleton with no pre-populated threats', () => {
    generateStrideEnforcement(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'SECURITY', 'STRIDE.md'), 'utf-8')
    expect(content).toContain('| ID |')
    expect(content).toContain('Severity')
    // No threat rows — empty table (threat IDs like S001 should not appear as table data)
    expect(content).not.toMatch(/\|\s*S\d{3}\s*\|/)
    // No HIGH/CRITICAL in table rows (comments may reference them as valid values)
    expect(content).not.toMatch(/^\|\s*\S+\s*\|[^|]+\|[^|]+\|\s*HIGH\s*\|/m)
    expect(content).not.toMatch(/^\|\s*\S+\s*\|[^|]+\|[^|]+\|\s*CRITICAL\s*\|/m)
  })

  it('check-stride-traceability.mjs has shebang', () => {
    generateStrideEnforcement(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-stride-traceability.mjs'), 'utf-8')
    expect(content).toMatch(/^#!/)
  })

  it('STRIDE.md skipIfExists — does not overwrite existing file', () => {
    generateStrideEnforcement(makeConfig(dir))
    const stridePath = join(dir, 'docs', 'SECURITY', 'STRIDE.md')
    writeFileSync(stridePath, 'EXISTING')
    const result = generateStrideEnforcement(makeConfig(dir))
    const strideFile = result.files.find((f) => f.path.endsWith('STRIDE.md'))
    expect(strideFile?.action).toBe('skipped')
    expect(readFileSync(stridePath, 'utf-8')).toBe('EXISTING')
  })

  it('RACI.md skipIfExists — does not overwrite existing file', () => {
    generateStrideEnforcement(makeConfig(dir))
    const raciPath = join(dir, 'docs', 'GOVERNANCE', 'RACI.md')
    writeFileSync(raciPath, 'EXISTING')
    const result = generateStrideEnforcement(makeConfig(dir))
    const raciFile = result.files.find((f) => f.path.endsWith('RACI.md'))
    expect(raciFile?.action).toBe('skipped')
    expect(readFileSync(raciPath, 'utf-8')).toBe('EXISTING')
  })

  it('check-stride-traceability.mjs always regenerated (not skipIfExists)', () => {
    const result1 = generateStrideEnforcement(makeConfig(dir))
    const script1 = result1.files.find((f) => f.path.endsWith('check-stride-traceability.mjs'))
    expect(script1?.action).toBe('created')

    const result2 = generateStrideEnforcement(makeConfig(dir))
    const script2 = result2.files.find((f) => f.path.endsWith('check-stride-traceability.mjs'))
    expect(script2?.action).not.toBe('skipped')
  })

  it('includes project name in generated files', () => {
    generateStrideEnforcement(makeConfig(dir, { projectName: 'my-app' }))
    const stride = readFileSync(join(dir, 'docs', 'SECURITY', 'STRIDE.md'), 'utf-8')
    const raci = readFileSync(join(dir, 'docs', 'GOVERNANCE', 'RACI.md'), 'utf-8')
    expect(stride).toContain('my-app')
    expect(raci).toContain('my-app')
  })
})

// ─── Generated script behavior (functional) ──────────────────────────────────

describe('check-stride-traceability.mjs — generated script', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
    generateStrideEnforcement(makeConfig(dir))
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function runScript(): ReturnType<typeof spawnSync> {
    return spawnSync('node', ['scripts/check-stride-traceability.mjs'], {
      cwd: dir,
      encoding: 'utf-8',
    })
  }

  function addStrideRow(row: string): void {
    const path = join(dir, 'docs', 'SECURITY', 'STRIDE.md')
    const existing = readFileSync(path, 'utf-8')
    writeFileSync(path, existing + '\n' + row)
  }

  function addSecurityTag(id: string): void {
    mkdirSync(join(dir, '__tests__'), { recursive: true })
    writeFileSync(
      join(dir, '__tests__', `${id}.test.ts`),
      `// @Security:${id}\ndescribe("${id}", () => { it("verified", () => {}) });\n`,
    )
  }

  it('passes on empty skeleton (no HIGH/CRITICAL rows)', () => {
    expect(runScript().status).toBe(0)
  })

  it('passes when docs/SECURITY/STRIDE.md does not exist', () => {
    rmSync(join(dir, 'docs', 'SECURITY', 'STRIDE.md'))
    expect(runScript().status).toBe(0)
  })

  it('fails when HIGH row has no @Security-tagged test', () => {
    addStrideRow('| S001 | Auth bypass | Spoofing | HIGH | Token validation | OPEN |')
    const result = runScript()
    expect(result.status).not.toBe(0)
    const out = result.stdout + result.stderr
    expect(out).toContain('S001')
  })

  it('reports line reference on failure', () => {
    addStrideRow('| S001 | Auth bypass | Spoofing | HIGH | Token validation | OPEN |')
    const result = runScript()
    const out = result.stdout + result.stderr
    // Should contain file:line reference
    expect(out).toMatch(/STRIDE\.md:\d+/)
  })

  it('fails when CRITICAL row has no @Security-tagged test', () => {
    addStrideRow('| S002 | SQL injection | Tampering | CRITICAL | Prepared stmts | OPEN |')
    const result = runScript()
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('S002')
  })

  it('passes when HIGH row has a matching @Security-tagged test', () => {
    addStrideRow('| S001 | Auth bypass | Spoofing | HIGH | Token validation | OPEN |')
    addSecurityTag('S001')
    expect(runScript().status).toBe(0)
  })

  it('passes when CRITICAL row has a matching @Security-tagged test', () => {
    addStrideRow('| S002 | SQL injection | Tampering | CRITICAL | Prepared stmts | OPEN |')
    addSecurityTag('S002')
    expect(runScript().status).toBe(0)
  })

  it('does not fail for MEDIUM rows without tagged tests', () => {
    addStrideRow(
      '| S003 | Info disclosure | Information Disclosure | MEDIUM | Logging policy | OPEN |',
    )
    expect(runScript().status).toBe(0)
  })

  it('does not fail for LOW rows without tagged tests', () => {
    addStrideRow('| S004 | Session timeout | Information Disclosure | LOW | Short TTL | ACCEPTED |')
    expect(runScript().status).toBe(0)
  })

  it('fails if any HIGH claim is missing even when others have tags', () => {
    addStrideRow('| S001 | Auth bypass | Spoofing | HIGH | Token validation | OPEN |')
    addStrideRow('| S002 | SQL injection | Tampering | HIGH | Prepared stmts | OPEN |')
    addSecurityTag('S001') // only S001 tagged
    const result = runScript()
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('S002')
  })

  it('remediation: adding @Security tag makes failing check pass', () => {
    addStrideRow('| S001 | Auth bypass | Spoofing | HIGH | Token validation | OPEN |')
    expect(runScript().status).not.toBe(0)
    addSecurityTag('S001')
    expect(runScript().status).toBe(0)
  })
})
