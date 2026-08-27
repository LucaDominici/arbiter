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
  // baseline emission at every level includes done-evidence.mjs and the journey recorder.
  // B6/#1491: the baseline .gitignore moved to the always-on `generateGitignore`
  // (registry key `baseline-gitignore`), so evidence-retention emits one fewer file.
  it('generates 5 files when harness on (rotate + prune + policy doc + done-evidence + journey recorder) at L1', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    expect(generateEvidenceRetention(config).files).toHaveLength(5)
  })

  it('generates 6 files at L4 (rotate + prune + policy doc + done-evidence + journey recorder + evidence-files)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L4' })
    expect(generateEvidenceRetention(config).files).toHaveLength(6)
  })

  it('generates 5 files at L2 (rotate + prune + policy doc + done-evidence + journey recorder)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    expect(generateEvidenceRetention(config).files).toHaveLength(5)
  })

  it('generates 5 files at L3 (rotate + prune + policy doc + done-evidence + journey recorder)', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    expect(generateEvidenceRetention(config).files).toHaveLength(5)
  })

  it('generates 3 files when harness off (no done-evidence) at L2', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2', enableEvidenceHarness: false })
    expect(generateEvidenceRetention(config).files).toHaveLength(3)
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

  it('generates scripts/record-journey-evidence.mjs whenever the harness is on', () => {
    generateEvidenceRetention(makeConfig(dir, { governanceLevel: 'L2' }))
    const path = join(dir, 'scripts', 'record-journey-evidence.mjs')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf-8')).toContain('--target artifact')
  })

  it('does not generate scripts/done-evidence.mjs when harness off', () => {
    generateEvidenceRetention(
      makeConfig(dir, { governanceLevel: 'L2', enableEvidenceHarness: false }),
    )
    expect(existsSync(join(dir, 'scripts', 'done-evidence.mjs'))).toBe(false)
  })

  it('does not generate scripts/record-journey-evidence.mjs when harness off', () => {
    generateEvidenceRetention(
      makeConfig(dir, { governanceLevel: 'L2', enableEvidenceHarness: false }),
    )
    expect(existsSync(join(dir, 'scripts', 'record-journey-evidence.mjs'))).toBe(false)
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

  it('does NOT emit .gitignore (moved to always-on baseline-gitignore, B6/#1491)', () => {
    const result = generateEvidenceRetention(makeConfig(dir))
    expect(result.files.some((f) => f.path.endsWith('.gitignore'))).toBe(false)
    expect(existsSync(join(dir, '.gitignore'))).toBe(false)
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
})

// ─── #1703: done-evidence writes reality_contact + no_overclaim (probe≠writer) ──
// The generated done-evidence.mjs must record reality_contact.{archetype,suite,
// command,recorded_at,passed} from the ACTUAL exit code of a real reality-contact
// suite, and no_overclaim=true only when gate green + reality passed + SHAs pinned.
// Anti-fake-green: a failing suite exits 1 and writes NOTHING.

describe('generateEvidenceRetention — done-evidence reality_contact/no_overclaim (#1703)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  /** Stub gate (scripts/check-all.mjs) that exits 0 — fakes a green L4 gate. */
  function stubGreenGate(d: string) {
    writeFileSync(join(d, 'scripts', 'check-all.mjs'), '#!/usr/bin/env node\nprocess.exit(0)\n')
  }

  /** Write a reality-contact stub script at repo root; returns the command string. */
  function writeRcStub(d: string, name: string, exitCode: number): string {
    writeFileSync(join(d, name), `process.exit(${exitCode})\n`)
    return `node ${name}`
  }

  /** Overwrite evidence-files.json to point reality_contact at a given command. */
  function setRcCommand(d: string, command: string, required: boolean) {
    writeFileSync(
      join(d, 'evidence-files.json'),
      JSON.stringify(
        {
          version: 1,
          pin_dirs: ['src'],
          pin_extensions: ['.ts'],
          exclude_dirs: ['node_modules', 'dist'],
          reality_contact: {
            archetype: 'backend-web-db',
            required,
            suite: 'live-api-e2e',
            command,
          },
        },
        null,
        2,
      ),
    )
  }

  function runDoneEvidence(d: string): ReturnType<typeof spawnSync> {
    return spawnSync('node', ['scripts/done-evidence.mjs'], { cwd: d, encoding: 'utf-8' })
  }

  it('green gate + passing reality-contact → evidence has reality_contact.passed=true + no_overclaim=true', () => {
    generateEvidenceRetention(
      makeConfig(dir, { archetype: 'backend-web-db', governanceLevel: 'L4' }),
    )
    stubGreenGate(dir)
    const cmd = writeRcStub(dir, 'rc-pass.mjs', 0)
    setRcCommand(dir, cmd, true)
    const res = runDoneEvidence(dir)
    expect(res.status, `stdout=${res.stdout}\nstderr=${res.stderr}`).toBe(0)
    const ev = JSON.parse(readFileSync(join(dir, '.claude', '.last-done-evidence.json'), 'utf-8'))
    expect(ev.reality_contact).toBeDefined()
    expect(ev.reality_contact.passed).toBe(true)
    expect(ev.reality_contact.suite).toBe('live-api-e2e')
    expect(ev.reality_contact.command).toBe(cmd)
    expect(ev.reality_contact.recorded_at).toBeTruthy()
    expect(ev.no_overclaim).toBe(true)
  })

  it('failing reality-contact → done-evidence exits 1 and writes NOTHING (anti-fake-green)', () => {
    generateEvidenceRetention(
      makeConfig(dir, { archetype: 'backend-web-db', governanceLevel: 'L4' }),
    )
    stubGreenGate(dir)
    const cmd = writeRcStub(dir, 'rc-fail.mjs', 1)
    setRcCommand(dir, cmd, true)
    const res = runDoneEvidence(dir)
    expect(res.status).toBe(1)
    expect(existsSync(join(dir, '.claude', '.last-done-evidence.json'))).toBe(false)
  })

  it('non-service archetype (required:false) → reality_contact.passed=null + no_overclaim=true, no command run', () => {
    generateEvidenceRetention(makeConfig(dir, { archetype: 'library', governanceLevel: 'L4' }))
    stubGreenGate(dir)
    // required:false → done-evidence must NOT execute any command; point at a
    // script that would FAIL if run, to prove it is not invoked.
    const cmd = writeRcStub(dir, 'rc-fail.mjs', 1)
    setRcCommand(dir, cmd, false)
    const res = runDoneEvidence(dir)
    expect(res.status, `stdout=${res.stdout}\nstderr=${res.stderr}`).toBe(0)
    const ev = JSON.parse(readFileSync(join(dir, '.claude', '.last-done-evidence.json'), 'utf-8'))
    expect(ev.reality_contact).toBeDefined()
    expect(ev.reality_contact.passed).toBe(null)
    expect(ev.reality_contact.required).toBe(false)
    expect(ev.no_overclaim).toBe(true)
  })

  it('generated done-evidence.mjs contains reality_contact + no_overclaim fields and archetype-aware DEFAULT_RC (#1703 render)', () => {
    generateEvidenceRetention(
      makeConfig(dir, { archetype: 'backend-web-db', governanceLevel: 'L2' }),
    )
    const src = readFileSync(join(dir, 'scripts', 'done-evidence.mjs'), 'utf-8')
    expect(src).toContain('reality_contact')
    expect(src).toContain('no_overclaim')
    expect(src).toContain('DEFAULT_RC')
    // Service archetype default is required:true with the live e2e runner.
    expect(src).toContain('required: true')
    expect(src).toContain('tests/api/run.sh')
  })

  it('generated done-evidence.mjs for a non-service archetype defaults required:false (#1703 render)', () => {
    generateEvidenceRetention(makeConfig(dir, { archetype: 'library', governanceLevel: 'L2' }))
    const src = readFileSync(join(dir, 'scripts', 'done-evidence.mjs'), 'utf-8')
    expect(src).toContain('DEFAULT_RC')
    // Non-service: required:false in the default.
    expect(src).toMatch(/required:\s*false/)
  })

  it('generated evidence-files.json (L4, service) declares a reality_contact block (#1703)', () => {
    generateEvidenceRetention(
      makeConfig(dir, { archetype: 'backend-web-db', governanceLevel: 'L4' }),
    )
    const cfg = JSON.parse(readFileSync(join(dir, 'evidence-files.json'), 'utf-8'))
    expect(cfg.reality_contact).toBeDefined()
    expect(cfg.reality_contact.required).toBe(true)
    expect(cfg.reality_contact.command).toContain('tests/api/run.sh')
  })

  it('generated evidence-files.json (L4, non-service) declares reality_contact required:false (#1703)', () => {
    generateEvidenceRetention(makeConfig(dir, { archetype: 'library', governanceLevel: 'L4' }))
    const cfg = JSON.parse(readFileSync(join(dir, 'evidence-files.json'), 'utf-8'))
    expect(cfg.reality_contact).toBeDefined()
    expect(cfg.reality_contact.required).toBe(false)
  })
})
