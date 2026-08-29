// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-agent-return.mjs + scripts/record-agent-return.mjs (E1 #1943).
 * Agent-return envelope (M8 core + M12 citation enforcement): validates every file under
 * .arbiter/evidence/agent-returns/** against schemas/agent-return.schema.json, resolves
 * structural citations against the envelope sha, and (under --enforce) cross-checks the
 * dispatch sidecar for evaporated returns.
 *
 * Existing Code Survey (CANON-16):
 *   - grep for agent-return: nothing; closest is check-evidence-bundle.mjs (different shape —
 *     TDD evidence per task, not sub-agent verdicts). New script justified.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHECK_SCRIPT = new URL('../../scripts/check-agent-return.mjs', import.meta.url).pathname
const RECORD_SCRIPT = new URL('../../scripts/record-agent-return.mjs', import.meta.url).pathname
const SCHEMA = new URL('../../schemas/agent-return.schema.json', import.meta.url).pathname

function runCheck(
  evidenceDir: string,
  opts: { enforce?: boolean; sidecar?: string; cwd?: string } = {},
): { exitCode: number; stdout: string; stderr: string } {
  const args = [
    CHECK_SCRIPT,
    `--evidence-dir=${evidenceDir}`,
    `--schema=${SCHEMA}`,
    '--repo-root',
    opts.cwd ?? evidenceDir,
  ]
  if (opts.enforce) args.push('--enforce')
  if (opts.sidecar) args.push(`--sidecar=${opts.sidecar}`)
  const result = spawnSync('node', args, { encoding: 'utf-8', timeout: 10000 })
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'arbiter-agent-return-v1',
    agent: 'red-team',
    role: 'skeptic',
    taskId: '#1943',
    branch: 'main',
    sha: '0123456789abcdef',
    ts: '2026-07-14T10:00:00.000Z',
    verdict: 'PASS',
    confidence: 0.8,
    findings: [],
    ...overrides,
  }
}

function writeEnvelope(evidenceDir: string, rel: string, body: Record<string, unknown>) {
  const full = join(evidenceDir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, JSON.stringify(body, null, 2))
}

describe('check-agent-return.mjs', () => {
  let tmpDir: string
  let evidenceDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agent-return-test-'))
    evidenceDir = join(tmpDir, '.arbiter', 'evidence', 'agent-returns')
    mkdirSync(evidenceDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // ─── Vacuous pass ──────────────────────────────────────────────────────────

  it('exits 0 when evidence dir does not exist', () => {
    const result = runCheck(join(tmpDir, 'nope'))
    expect(result.exitCode).toBe(0)
  })

  it('exits 0 when dir exists but has no envelopes', () => {
    const result = runCheck(evidenceDir)
    expect(result.exitCode).toBe(0)
  })

  // ─── Valid envelopes ───────────────────────────────────────────────────────

  it('exits 0 for a valid envelope with no findings', () => {
    writeEnvelope(evidenceDir, '#1943/red-team-1.json', envelope())
    expect(runCheck(evidenceDir).exitCode).toBe(0)
  })

  it('exits 0 for envelope with a behavioral finding (citation optional)', () => {
    writeEnvelope(
      evidenceDir,
      '#1943/red-team-1.json',
      envelope({
        findings: [
          {
            id: 'f1',
            severity: 'med',
            kind: 'behavioral',
            claim: 'loop spins on stale state',
            citations: [],
          },
        ],
      }),
    )
    expect(runCheck(evidenceDir).exitCode).toBe(0)
  })

  it('exits 0 for structural finding with a resolvable citation', () => {
    // Point the citation at a real file in the tmp cwd (non-git fixture → fs resolver).
    mkdirSync(join(tmpDir, 'src'), { recursive: true })
    writeFileSync(join(tmpDir, 'src/x.ts'), 'export const z = 1\n')
    writeEnvelope(
      evidenceDir,
      '#1943/red-team-1.json',
      envelope({
        sha: 'abcdef0',
        findings: [
          {
            id: 'f1',
            severity: 'high',
            kind: 'structural',
            claim: 'bad export',
            citations: [{ file: 'src/x.ts', line: 1 }],
          },
        ],
      }),
    )
    expect(runCheck(evidenceDir, { cwd: tmpDir }).exitCode).toBe(0)
  })

  // ─── Schema violations ────────────────────────────────────────────────────

  it('exits 1 for an envelope with verdict MAYBE (not in enum)', () => {
    writeEnvelope(evidenceDir, '#1943/red-team-1.json', envelope({ verdict: 'MAYBE' }))
    const r = runCheck(evidenceDir)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/verdict/i)
  })

  it('exits 1 for an envelope missing a required field (agent)', () => {
    const e = envelope()
    delete e.agent
    writeEnvelope(evidenceDir, '#1943/red-team-1.json', e)
    expect(runCheck(evidenceDir).exitCode).toBe(1)
  })

  it('exits 1 for an envelope with an additional property', () => {
    writeEnvelope(evidenceDir, '#1943/red-team-1.json', envelope({ extra: 1 }))
    expect(runCheck(evidenceDir).exitCode).toBe(1)
  })

  // ─── M12 citation enforcement ─────────────────────────────────────────────

  it('exits 1 for a structural finding with no citations', () => {
    writeEnvelope(
      evidenceDir,
      '#1943/red-team-1.json',
      envelope({
        findings: [
          {
            id: 'f1',
            severity: 'high',
            kind: 'structural',
            claim: 'the architecture is fiction',
            citations: [],
          },
        ],
      }),
    )
    const r = runCheck(evidenceDir)
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/citation/i)
  })

  it('exits 1 for a structural finding whose citation file does not resolve', () => {
    writeEnvelope(
      evidenceDir,
      '#1943/red-team-1.json',
      envelope({
        sha: 'abcdef0',
        findings: [
          {
            id: 'f1',
            severity: 'high',
            kind: 'structural',
            claim: 'fiction',
            citations: [{ file: 'src/nope.ts', line: 1 }],
          },
        ],
      }),
    )
    const r = runCheck(evidenceDir, { cwd: tmpDir })
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/src\/nope\.ts/)
  })

  it('exits 1 for a citation line beyond file length', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true })
    writeFileSync(join(tmpDir, 'src/x.ts'), 'one line\n')
    writeEnvelope(
      evidenceDir,
      '#1943/red-team-1.json',
      envelope({
        sha: 'abcdef0',
        findings: [
          {
            id: 'f1',
            severity: 'high',
            kind: 'structural',
            claim: 'fiction',
            citations: [{ file: 'src/x.ts', line: 99 }],
          },
        ],
      }),
    )
    expect(runCheck(evidenceDir, { cwd: tmpDir }).exitCode).toBe(1)
  })

  // ─── --enforce dispatch cross-check ────────────────────────────────────────

  it('exits 1 under --enforce when sidecar records dispatches but no envelopes exist', () => {
    const sidecar = join(tmpDir, 'agents-dispatched.json')
    writeFileSync(sidecar, JSON.stringify({ branch: 'main', count: 3, ts: '2026-07-14T10:00:00Z' }))
    // evidence dir empty
    const r = runCheck(evidenceDir, { enforce: true, sidecar, cwd: tmpDir })
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/evaporated|dispatch/i)
  })

  // #2399: the tracked sidecar is shared by every branch — one recorded for another task
  // says nothing about this task's returns.
  it('exits 0 under --enforce when the sidecar belongs to another task', () => {
    const sidecar = join(tmpDir, 'agents-dispatched.json')
    writeFileSync(
      sidecar,
      JSON.stringify({ branch: 'main', count: 3, taskId: '#9999', ts: '2026-07-14T10:00:00Z' }),
    )
    mkdirSync(join(tmpDir, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(tmpDir, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#2399' }),
    )
    const r = runCheck(evidenceDir, { enforce: true, sidecar, cwd: tmpDir })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('#9999')
  })

  it('keeps the cross-check armed under --enforce when no active task is known', () => {
    const sidecar = join(tmpDir, 'agents-dispatched.json')
    writeFileSync(
      sidecar,
      JSON.stringify({ branch: 'main', count: 3, taskId: '#9999', ts: '2026-07-14T10:00:00Z' }),
    )
    expect(runCheck(evidenceDir, { enforce: true, sidecar, cwd: tmpDir }).exitCode).toBe(1)
  })

  it('exits 0 without --enforce even when sidecar records dispatches and no envelopes', () => {
    const sidecar = join(tmpDir, 'agents-dispatched.json')
    writeFileSync(sidecar, JSON.stringify({ branch: 'main', count: 3, ts: '2026-07-14T10:00:00Z' }))
    expect(runCheck(evidenceDir, { sidecar, cwd: tmpDir }).exitCode).toBe(0)
  })
})

describe('record-agent-return.mjs', () => {
  let tmpDir: string
  let evidenceDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'record-agent-return-'))
    evidenceDir = join(tmpDir, '.arbiter', 'evidence', 'agent-returns')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects malformed stdin with exit 1 and writes nothing', () => {
    const result = spawnSync('node', [RECORD_SCRIPT, '--task', '#1943', '--repo-root', tmpDir], {
      input: 'not json',
      encoding: 'utf-8',
      timeout: 10000,
    })
    expect(result.status).toBe(1)
    expect(existsSync(evidenceDir)).toBe(false)
  })

  it('rejects an envelope with a verdict not in enum and writes nothing', () => {
    const bad = envelope({ verdict: 'MAYBE' })
    delete bad.sha
    const result = spawnSync(
      'node',
      [RECORD_SCRIPT, '--task', '#1943', '--evidence-dir', evidenceDir, '--repo-root', tmpDir],
      {
        input: JSON.stringify(bad),
        encoding: 'utf-8',
        timeout: 10000,
      },
    )
    expect(result.status).toBe(1)
    expect(existsSync(evidenceDir)).toBe(false)
  })

  it('writes a stamped envelope for valid input and exits 0', () => {
    const valid = envelope()
    delete (valid as Record<string, unknown>).sha
    delete (valid as Record<string, unknown>).branch
    delete (valid as Record<string, unknown>).ts
    const result = spawnSync('node', [RECORD_SCRIPT, '--task', '#1943', '--repo-root', tmpDir], {
      input: JSON.stringify(valid),
      encoding: 'utf-8',
      timeout: 10000,
    })
    expect(result.status).toBe(0)
    // one json file under _1943/ (sanitizeTaskId('#1943') → '_1943')
    const taskDir = join(evidenceDir, '_1943')
    const files = existsSync(taskDir) ? readdirSync(taskDir) : []
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/red-team-\d+\.json/)
    const written = JSON.parse(readFileSync(join(taskDir, files[0]), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(written.sha).toMatch(/^[0-9a-f]{7,40}$/)
    expect(written.branch).toBeTruthy()
    expect(written.ts).toBeTruthy()
  })

  it('stamps default Anthropic provenance and overwrites incoming provenance', () => {
    const valid = envelope({ provenance: { vendor: 'openai', dispatch: 'external-cli' } })
    delete (valid as Record<string, unknown>).sha
    delete (valid as Record<string, unknown>).branch
    delete (valid as Record<string, unknown>).ts
    const result = spawnSync(
      'node',
      [RECORD_SCRIPT, '--task', '#1943', '--evidence-dir', evidenceDir, '--repo-root', tmpDir],
      {
        input: JSON.stringify(valid),
        encoding: 'utf-8',
        timeout: 10000,
      },
    )
    expect(result.status).toBe(0)
    const taskDir = join(evidenceDir, '_1943')
    const files = readdirSync(taskDir)
    const written = JSON.parse(readFileSync(join(taskDir, files[0]!), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(written.provenance).toEqual({ vendor: 'anthropic', dispatch: 'subagent' })
  })

  it('stamps explicit external-cli provenance flags', () => {
    const valid = envelope()
    delete (valid as Record<string, unknown>).sha
    delete (valid as Record<string, unknown>).branch
    delete (valid as Record<string, unknown>).ts
    const result = spawnSync(
      'node',
      [
        RECORD_SCRIPT,
        '--task',
        '#1943',
        '--evidence-dir',
        evidenceDir,
        '--repo-root',
        tmpDir,
        '--provenance-vendor',
        'openai',
        '--provenance-cli',
        'codex',
        '--provenance-cli-version',
        '0.5.1',
        '--provenance-dispatch',
        'external-cli',
      ],
      {
        input: JSON.stringify(valid),
        encoding: 'utf-8',
        timeout: 10000,
      },
    )
    expect(result.status).toBe(0)
    const taskDir = join(evidenceDir, '_1943')
    const files = readdirSync(taskDir)
    const written = JSON.parse(readFileSync(join(taskDir, files[0]!), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(written.provenance).toEqual({
      vendor: 'openai',
      dispatch: 'external-cli',
      cli: 'codex',
      cliVersion: '0.5.1',
    })
  })

  it('rejects a symlinked evidence directory before writing outside the repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'record-agent-return-outside-'))
    const linkedEvidenceDir = join(tmpDir, '.arbiter', 'evidence', 'agent-returns')
    try {
      mkdirSync(join(tmpDir, '.arbiter', 'evidence'), { recursive: true })
      symlinkSync(outside, linkedEvidenceDir, 'dir')
      const valid = envelope()
      delete (valid as Record<string, unknown>).sha
      delete (valid as Record<string, unknown>).branch
      delete (valid as Record<string, unknown>).ts
      const result = spawnSync('node', [RECORD_SCRIPT, '--task', '#1943', '--repo-root', tmpDir], {
        input: JSON.stringify(valid),
        encoding: 'utf-8',
        timeout: 10000,
      })
      expect(result.status).toBe(2)
      expect(readdirSync(outside)).toEqual([])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
