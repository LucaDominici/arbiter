import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateEvidenceRetention } from '../../src/generators/evidence-retention.js'

// ─── Generator tests ─────────────────────────────────────────────────────────

describe('generateEvidenceRetention', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates 2 files at L1 (rotate script + gitignore)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    expect(generateEvidenceRetention(config).files).toHaveLength(2)
  })

  it('generates 4 files at L2+ (rotate + gitignore + done-evidence + evidence-files)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    expect(generateEvidenceRetention(config).files).toHaveLength(4)
  })

  it('generates scripts/done-evidence.mjs at L2+', () => {
    generateEvidenceRetention(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'scripts', 'done-evidence.mjs'))).toBe(true)
  })

  it('does not generate scripts/done-evidence.mjs at L1', () => {
    generateEvidenceRetention(makeConfig(dir, { governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'scripts', 'done-evidence.mjs'))).toBe(false)
  })

  it('generates evidence-files.json at L2+', () => {
    generateEvidenceRetention(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'evidence-files.json'))).toBe(true)
  })

  it('generates scripts/evidence-rotate.mjs', () => {
    generateEvidenceRetention(makeConfig(dir))
    expect(existsSync(join(dir, 'scripts', 'evidence-rotate.mjs'))).toBe(true)
  })

  it('generates .gitignore', () => {
    generateEvidenceRetention(makeConfig(dir))
    expect(existsSync(join(dir, '.gitignore'))).toBe(true)
  })

  it('.gitignore contains .evidence/ entry', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(content).toContain('.evidence/')
  })

  it('.gitignore contains common entries', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('dist/')
    expect(content).toContain('.env')
  })

  it('.gitignore contains local Arbiter runtime state entries', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(content).toContain('.arbiter/')
    expect(content).toContain('.agents-dispatched')
    expect(content).toContain('.claude/.task-*')
    expect(content).toContain('.claude/plans/')
  })

  it('.gitignore skipIfExists — does not overwrite existing file', () => {
    generateEvidenceRetention(makeConfig(dir))
    const gitignorePath = join(dir, '.gitignore')
    writeFileSync(gitignorePath, 'EXISTING')
    const result = generateEvidenceRetention(makeConfig(dir))
    const file = result.files.find((f) => f.path.endsWith('.gitignore'))
    expect(file?.action).toBe('skipped')
    expect(readFileSync(gitignorePath, 'utf-8')).toBe('EXISTING')
  })

  it('evidence-rotate.mjs always regenerated (not skipIfExists)', () => {
    const r1 = generateEvidenceRetention(makeConfig(dir))
    const r2 = generateEvidenceRetention(makeConfig(dir))
    const s1 = r1.files.find((f) => f.path.endsWith('evidence-rotate.mjs'))
    const s2 = r2.files.find((f) => f.path.endsWith('evidence-rotate.mjs'))
    expect(s1?.action).toBe('created')
    expect(s2?.action).not.toBe('skipped')
  })

  it('evidence-rotate.mjs has shebang', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'evidence-rotate.mjs'), 'utf-8')
    expect(content).toMatch(/^#!/)
  })

  it('uses evidenceRetention.count from config (defaults to 5)', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'evidence-rotate.mjs'), 'utf-8')
    expect(content).toContain('5')
  })

  it('uses custom count from evidenceRetention config', () => {
    generateEvidenceRetention(
      makeConfig(dir, {
        evidenceRetention: { mode: 'local-last-N', count: 10 },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'evidence-rotate.mjs'), 'utf-8')
    expect(content).toContain('10')
  })

  it('external-bucket mode generates stub with credentials warning', () => {
    generateEvidenceRetention(
      makeConfig(dir, {
        evidenceRetention: {
          mode: 'external-bucket',
          bucketUrl: 's3://my-bucket/evidence',
        },
      }),
    )
    const content = readFileSync(join(dir, 'scripts', 'evidence-rotate.mjs'), 'utf-8')
    expect(content).toContain('s3://my-bucket/evidence')
    expect(content).toMatch(/credential|secret|warn/i)
  })

  it('local-last-N mode (default) does not include bucket URL', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'evidence-rotate.mjs'), 'utf-8')
    expect(content).not.toContain('s3://')
    expect(content).not.toContain('bucket')
  })
})

// ─── Generated script behavior (functional rotation) ─────────────────────────

describe('evidence-rotate.mjs — rotation behavior', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
    generateEvidenceRetention(makeConfig(dir))
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  function runRotate(): ReturnType<typeof spawnSync> {
    return spawnSync('node', ['scripts/evidence-rotate.mjs'], {
      cwd: dir,
      encoding: 'utf-8',
    })
  }

  function createRuns(count: number): void {
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir, { recursive: true })
    for (let i = 1; i <= count; i++) {
      const runDir = join(evidenceDir, `run-${String(i).padStart(4, '0')}`)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(join(runDir, 'result.json'), JSON.stringify({ run: i }))
    }
  }

  function listRuns(): string[] {
    const evidenceDir = join(dir, '.evidence')
    if (!existsSync(evidenceDir)) return []
    try {
      return readdirSync(evidenceDir)
        .filter((n) => n.startsWith('run-'))
        .sort()
    } catch {
      return []
    }
  }

  it('passes when .evidence/ does not exist', () => {
    expect(runRotate().status).toBe(0)
  })

  it('passes when fewer than 5 runs exist', () => {
    createRuns(3)
    expect(runRotate().status).toBe(0)
  })

  it('passes when exactly 5 runs exist', () => {
    createRuns(5)
    expect(runRotate().status).toBe(0)
  })

  it('keeps last 5 when 7 runs exist', () => {
    createRuns(7)
    expect(runRotate().status).toBe(0)
    const remaining = listRuns()
    expect(remaining).toHaveLength(5)
    // Should keep the newest (run-0003 through run-0007)
    expect(remaining).toContain('run-0007')
    expect(remaining).toContain('run-0003')
    expect(remaining).not.toContain('run-0001')
    expect(remaining).not.toContain('run-0002')
  })

  it('keeps last 5 when 10 runs exist', () => {
    createRuns(10)
    runRotate()
    const remaining = listRuns()
    expect(remaining).toHaveLength(5)
    expect(remaining).toContain('run-0010')
    expect(remaining).not.toContain('run-0005')
  })
})
