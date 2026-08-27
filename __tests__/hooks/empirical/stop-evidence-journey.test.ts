import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../../src/utils/render.js'
import {
  makeConfig,
  materializeGateEvidenceLib,
  writeGatePassEvidence,
  writeTaskStateFile,
} from '../../helpers.js'

// #A2 (extends INV-114) — journey-first Definition-of-Done. When the evidence harness is on, a
// completion claim additionally requires JOURNEY evidence: a run of the task's declared acceptance
// E2E spec against the BUILT ARTIFACT (not the dev server). These tests spawn the rendered hook
// against a real git repo and prove the check bites (exit 2) on missing / dev-server-only journey
// evidence, and that it is entirely absent when the harness is off (config-gated).

const TASK_ID = '#1212'
const SANITIZED_ID = '_1212' // sanitizeTaskId('#1212')
const CLAIM = 'task complete, ready to merge'

function configFor(evidenceHarness: boolean) {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L3',
    buildTool: 'npm',
    enableEvidenceHarness: evidenceHarness,
  })
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

function setup(evidenceHarness: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-stop-journey-'))
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])

  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  const cfg = configFor(evidenceHarness)
  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', cfg))
  const hookPath = join(hooksDir, 'stop-evidence-guard.mjs')
  writeFileSync(hookPath, renderTemplate('claude/hooks/stop-evidence-guard.mjs.ejs', cfg))

  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  // #2328: the hook verifies the gate-pass marker through this shared library.
  materializeGateEvidenceLib(dir)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-m', 'init', '--no-gpg-sign'])
  git(dir, ['checkout', '-b', 'task/1212'])

  writeTaskStateFile(dir, { phase: 'green', tier: 'Standard', taskId: TASK_ID })

  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const sha = git(dir, ['rev-parse', 'HEAD'])
  return { dir, hookPath, branch, sha }
}

/** Write the three baseline correlated artifacts (plan-review, dispatch, gate-pass). */
function writeBaselineEvidence(dir: string, branch: string, sha: string) {
  const prDir = join(dir, '.arbiter', 'evidence', 'plan-review', SANITIZED_ID)
  mkdirSync(prDir, { recursive: true })
  writeFileSync(
    join(prDir, 'latest.json'),
    JSON.stringify({ verdict: 'PASS', branch, sha, planDigest: 'x'.repeat(64), tier: 'Standard' }),
  )
  writeFileSync(
    join(dir, '.arbiter', 'agents-dispatched.json'),
    JSON.stringify({ count: 4, branch, sha }),
  )
  writeGatePassEvidence(dir, { taskId: TASK_ID })
}

interface JourneyOpts {
  branch?: string
  sha?: string
  spec?: string
  target?: string
}

function writeJourney(dir: string, branch: string, sha: string, opts: JourneyOpts = {}) {
  const jDir = join(dir, '.arbiter', 'evidence', 'journey')
  mkdirSync(jDir, { recursive: true })
  writeFileSync(
    join(jDir, SANITIZED_ID + '.json'),
    JSON.stringify({
      branch: opts.branch ?? branch,
      sha: opts.sha ?? sha,
      spec: opts.spec ?? 'e2e/checkout.spec.ts',
      target: opts.target ?? 'artifact',
    }),
  )
}

// #2328: the transcript lives OUTSIDE the gated tree — in production it sits
// under the agent's own state dir, and writing it into the repo would change the
// working-tree hash the gate-pass marker binds.
function claimTranscript(): string {
  const p = join(mkdtempSync(join(tmpdir(), 'arbiter-stop-journey-t-')), 'transcript.jsonl')
  writeFileSync(
    p,
    [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'finish it' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: CLAIM }] },
      }),
    ].join('\n') + '\n',
  )
  return p
}

function runHook(hookPath: string, dir: string, transcriptPath: string) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 's1',
      cwd: dir,
      transcript_path: transcriptPath,
    }),
    encoding: 'utf-8',
  })
}

describe('stop-evidence-guard — journey-first DoD (#A2)', () => {
  it('materializes the harness journey block in the self hook (AC-2382.2)', () => {
    const raw = readFileSync(
      join(process.cwd(), '.claude', 'hooks', 'stop-evidence-guard.mjs'),
      'utf8',
    )
    expect(raw).toContain(
      'A completion claim requires plan-review + dispatch + gate-pass + journey evidence',
    )
    expect(raw).toContain('// 4. journey evidence (#A2, extends INV-114)')
    expect(raw).toContain("sanitizeTaskId(taskId) + '.json'")
    expect(raw).toContain("journey.target !== 'artifact'")
  })

  it('exits 0 when all baseline + journey (target=artifact) evidence is valid', () => {
    const { dir, hookPath, branch, sha } = setup(true)
    try {
      writeBaselineEvidence(dir, branch, sha)
      writeJourney(dir, branch, sha)
      const r = runHook(hookPath, dir, claimTranscript())
      expect(r.status).toBe(0)
      expect(r.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when journey evidence is missing (baseline three present)', () => {
    const { dir, hookPath, branch, sha } = setup(true)
    try {
      writeBaselineEvidence(dir, branch, sha)
      const r = runHook(hookPath, dir, claimTranscript())
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/journey/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when the journey ran dev-server-only (target != artifact)', () => {
    const { dir, hookPath, branch, sha } = setup(true)
    try {
      writeBaselineEvidence(dir, branch, sha)
      writeJourney(dir, branch, sha, { target: 'dev-server' })
      const r = runHook(hookPath, dir, claimTranscript())
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/artifact/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when journey evidence names no acceptance spec', () => {
    const { dir, hookPath, branch, sha } = setup(true)
    try {
      writeBaselineEvidence(dir, branch, sha)
      writeJourney(dir, branch, sha, { spec: '' })
      const r = runHook(hookPath, dir, claimTranscript())
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/spec/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when journey evidence is for a different branch', () => {
    const { dir, hookPath, branch, sha } = setup(true)
    try {
      writeBaselineEvidence(dir, branch, sha)
      writeJourney(dir, branch, sha, { branch: 'task/other' })
      const r = runHook(hookPath, dir, claimTranscript())
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/journey/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when journey sha is not an ancestor of HEAD (stale)', () => {
    const { dir, hookPath, branch, sha } = setup(true)
    try {
      writeBaselineEvidence(dir, branch, sha)
      writeJourney(dir, branch, sha, { sha: '0'.repeat(40) })
      const r = runHook(hookPath, dir, claimTranscript())
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/journey/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 with only baseline evidence when the harness is OFF (config-gated, no journey check)', () => {
    const { dir, hookPath, branch, sha } = setup(false)
    try {
      // No journey evidence at all — but the check is not rendered when the harness is off,
      // so the three baseline artifacts are sufficient to allow the stop.
      writeBaselineEvidence(dir, branch, sha)
      const r = runHook(hookPath, dir, claimTranscript())
      expect(r.status).toBe(0)
      expect(r.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
