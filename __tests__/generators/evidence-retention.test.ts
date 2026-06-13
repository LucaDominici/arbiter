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

  // #1345: done-evidence.mjs is emitted whenever the evidence harness is on (the
  // SAME condition as its guard hook), NOT L4-only. evidence-files.json stays
  // L4-only. The harness defaults ON (enableEvidenceHarness !== false), so the
  // baseline emission at every level includes done-evidence.mjs.
  it('generates 5 files when harness on (rotate + prune + gitignore + policy doc + done-evidence) at L1', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    expect(generateEvidenceRetention(config).files).toHaveLength(5)
  })

  it('generates 6 files at L4 (rotate + prune + gitignore + policy doc + done-evidence + evidence-files)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    expect(generateEvidenceRetention(config).files).toHaveLength(6)
  })

  it('generates 5 files at L2 (rotate + prune + gitignore + policy doc + done-evidence)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    expect(generateEvidenceRetention(config).files).toHaveLength(5)
  })

  it('generates 5 files at L3 (rotate + prune + gitignore + policy doc + done-evidence)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    expect(generateEvidenceRetention(config).files).toHaveLength(5)
  })

  it('generates 4 files when harness off (no done-evidence) at L2', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2', enableEvidenceHarness: false })
    expect(generateEvidenceRetention(config).files).toHaveLength(4)
  })

  it('generates scripts/done-evidence.mjs at L4', () => {
    generateEvidenceRetention(makeConfig(dir, { governanceLevel: 'L4' }))
    expect(existsSync(join(dir, 'scripts', 'done-evidence.mjs'))).toBe(true)
  })

  it('generates scripts/done-evidence.mjs at L2 when harness on (#1345 — guard/script parity)', () => {
    generateEvidenceRetention(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'scripts', 'done-evidence.mjs'))).toBe(true)
  })

  it('generates scripts/done-evidence.mjs at L3 when harness on', () => {
    generateEvidenceRetention(makeConfig(dir, { governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'scripts', 'done-evidence.mjs'))).toBe(true)
  })

  it('does not generate scripts/done-evidence.mjs when harness off', () => {
    generateEvidenceRetention(
      makeConfig(dir, { governanceLevel: 'L2', enableEvidenceHarness: false }),
    )
    expect(existsSync(join(dir, 'scripts', 'done-evidence.mjs'))).toBe(false)
  })

  it('generates evidence-files.json at L4', () => {
    generateEvidenceRetention(makeConfig(dir, { governanceLevel: 'L4' }))
    expect(existsSync(join(dir, 'evidence-files.json'))).toBe(true)
  })

  it('does not generate evidence-files.json at L2', () => {
    generateEvidenceRetention(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'evidence-files.json'))).toBe(false)
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
    expect(content).toContain('website/.vitepress/.temp/')
  })

  it('.gitignore contains local Arbiter runtime state entries', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(content).toContain('.arbiter/')
    expect(content).toContain('.agents-dispatched')
    expect(content).toContain('.claude/.task-*')
    expect(content).toContain('.claude/plans/')
    expect(content).toContain('*.arbiter-backup')
    expect(content).toContain('.arbiter-generated.json.bak.*')
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

  it('evidence-rotate.mjs is regenerated (backup-managed, not skipIfExists) when content differs', () => {
    // evidence-rotate.mjs is a backup=true file (not skipIfExists): a user edit is
    // backed up and replaced on the next run. (#1077: an unchanged re-run skips —
    // see the idempotence test below — so this asserts the DIFFERING branch.)
    const r1 = generateEvidenceRetention(makeConfig(dir))
    const s1 = r1.files.find((f) => f.path.endsWith('evidence-rotate.mjs'))
    expect(s1?.action).toBe('created')
    writeFileSync(s1!.path, '// user-edited\n', 'utf-8')
    const r2 = generateEvidenceRetention(makeConfig(dir))
    const s2 = r2.files.find((f) => f.path.endsWith('evidence-rotate.mjs'))
    expect(s2?.action).toBe('backed-up-and-replaced')
  })

  it('evidence-rotate.mjs skips a byte-identical re-run with no backup (#1077 F6)', () => {
    const config = makeConfig(dir)
    const r1 = generateEvidenceRetention(config)
    const path = r1.files.find((f) => f.path.endsWith('evidence-rotate.mjs'))!.path
    const r2 = generateEvidenceRetention(config)
    const f = r2.files.find((x) => x.path.endsWith('evidence-rotate.mjs'))
    expect(f?.action).toBe('skipped')
    expect(existsSync(`${path}.arbiter-backup`)).toBe(false)
  })

  it('evidence-rotate.mjs creates .arbiter-backup when content differs on second run (#293/#1077)', () => {
    const config = makeConfig(dir)
    const r1 = generateEvidenceRetention(config)
    const path = r1.files.find((x) => x.path.endsWith('evidence-rotate.mjs'))!.path
    writeFileSync(path, '// user-edited\n', 'utf-8')
    const r2 = generateEvidenceRetention(config)
    const f = r2.files.find((x) => x.path.endsWith('evidence-rotate.mjs'))
    expect(f?.action).toBe('backed-up-and-replaced')
    expect(existsSync(`${path}.arbiter-backup`)).toBe(true)
  })

  it('done-evidence.mjs creates .arbiter-backup when content differs on second run at L4 (#293/#1077)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    const r1 = generateEvidenceRetention(config)
    const path = r1.files.find((x) => x.path.endsWith('done-evidence.mjs'))!.path
    writeFileSync(path, '// user-edited\n', 'utf-8')
    const r2 = generateEvidenceRetention(config)
    const f = r2.files.find((x) => x.path.endsWith('done-evidence.mjs'))
    expect(f?.action).toBe('backed-up-and-replaced')
    expect(existsSync(`${path}.arbiter-backup`)).toBe(true)
  })

  it('done-evidence.mjs skips a byte-identical re-run with no backup at L4 (#1077 F6)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    const r1 = generateEvidenceRetention(config)
    const path = r1.files.find((x) => x.path.endsWith('done-evidence.mjs'))!.path
    const r2 = generateEvidenceRetention(config)
    const f = r2.files.find((x) => x.path.endsWith('done-evidence.mjs'))
    expect(f?.action).toBe('skipped')
    expect(existsSync(`${path}.arbiter-backup`)).toBe(false)
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

// ─── evidence-prune.mjs — generator tests (#718) ─────────────────────────────

describe('generateEvidenceRetention — evidence-prune.mjs (#718)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates scripts/evidence-prune.mjs', () => {
    generateEvidenceRetention(makeConfig(dir))
    expect(existsSync(join(dir, 'scripts', 'evidence-prune.mjs'))).toBe(true)
  })

  it('evidence-prune.mjs has shebang', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'evidence-prune.mjs'), 'utf-8')
    expect(content).toMatch(/^#!/)
  })

  it('evidence-prune.mjs is skipIfExists', () => {
    generateEvidenceRetention(makeConfig(dir))
    writeFileSync(join(dir, 'scripts', 'evidence-prune.mjs'), 'EXISTING')
    const r2 = generateEvidenceRetention(makeConfig(dir))
    const f = r2.files.find((x) => x.path.endsWith('evidence-prune.mjs'))
    expect(f?.action).toBe('skipped')
    expect(readFileSync(join(dir, 'scripts', 'evidence-prune.mjs'), 'utf-8')).toBe('EXISTING')
  })

  it('evidence-prune.mjs supports --dry-run flag', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'evidence-prune.mjs'), 'utf-8')
    expect(content).toContain('--dry-run')
  })

  it('evidence-prune.mjs supports --keep-last flag', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'evidence-prune.mjs'), 'utf-8')
    expect(content).toContain('--keep-last')
  })

  it('evidence-prune.mjs supports --yes flag (skip ACK prompt)', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'evidence-prune.mjs'), 'utf-8')
    expect(content).toContain('--yes')
  })
})

// ─── evidence-prune.mjs — functional behavior (#718) ─────────────────────────

describe('evidence-prune.mjs — functional behavior (#718)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
    generateEvidenceRetention(makeConfig(dir))
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

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

  function runPrune(args: string[]): ReturnType<typeof spawnSync> {
    return spawnSync('node', ['scripts/evidence-prune.mjs', ...args], {
      cwd: dir,
      encoding: 'utf-8',
      input: '\n',
    })
  }

  it('--dry-run removes nothing', () => {
    createRuns(10)
    const result = runPrune(['--dry-run', '--keep-last=3'])
    expect(result.status).toBe(0)
    expect(listRuns()).toHaveLength(10)
  })

  it('--yes --keep-last=3 removes old runs', () => {
    createRuns(10)
    const result = runPrune(['--yes', '--keep-last=3'])
    expect(result.status).toBe(0)
    expect(listRuns()).toHaveLength(3)
    expect(listRuns()).toContain('run-0010')
    expect(listRuns()).not.toContain('run-0001')
  })

  it('passes when .evidence/ does not exist', () => {
    expect(runPrune(['--yes', '--keep-last=5']).status).toBe(0)
  })
})

// ─── evidence-retention policy doc — generator tests (#718) ──────────────────

describe('generateEvidenceRetention — policy doc (#718)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates docs/METHOD/EVIDENCE_RETENTION.md', () => {
    generateEvidenceRetention(makeConfig(dir))
    expect(existsSync(join(dir, 'docs', 'METHOD', 'EVIDENCE_RETENTION.md'))).toBe(true)
  })

  it('policy doc is skipIfExists', () => {
    generateEvidenceRetention(makeConfig(dir))
    const policyPath = join(dir, 'docs', 'METHOD', 'EVIDENCE_RETENTION.md')
    writeFileSync(policyPath, 'CUSTOM')
    const r2 = generateEvidenceRetention(makeConfig(dir))
    const f = r2.files.find((x) => x.path.endsWith('EVIDENCE_RETENTION.md'))
    expect(f?.action).toBe('skipped')
    expect(readFileSync(policyPath, 'utf-8')).toBe('CUSTOM')
  })

  it('policy doc contains project name', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'METHOD', 'EVIDENCE_RETENTION.md'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('policy doc contains retention mode', () => {
    generateEvidenceRetention(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'METHOD', 'EVIDENCE_RETENTION.md'), 'utf-8')
    expect(content).toContain('local-last-N')
  })

  // #1328 unit 7 (Track-B): the emitted .gitignore must NOT ignore the committed
  // generated-manifest, or the governed fleet silently loses provenance and
  // `update` propagates nothing (the very property INV-122 asserts).
  it('emitted .gitignore does NOT ignore .arbiter-generated-manifest.json (fleet provenance must be committed)', () => {
    generateEvidenceRetention(makeConfig(dir))
    const isIgnored = (rel: string): boolean => {
      writeFileSync(join(dir, rel), 'x')
      return spawnSync('git', ['check-ignore', '-q', rel], { cwd: dir }).status === 0
    }
    // The manifest and the snapshot envelope (both committed) must NOT be ignored.
    expect(isIgnored('.arbiter-generated-manifest.json')).toBe(false)
    expect(isIgnored('.arbiter-generated.json')).toBe(false)
    // Sanity: the template still ignores the runtime .arbiter/ dir (intent preserved).
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    expect(isIgnored('.arbiter/scratch.tmp')).toBe(true)
  })
})
