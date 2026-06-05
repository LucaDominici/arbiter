import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

// #1212 — fail-closed Stop hook. Spawns the rendered hook against a real git
// repo and asserts exit 2 (block the stop) only when a completion claim is made
// AND the three correlated evidence artifacts are missing or stale.

function configFor() {
  return makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
    buildTool: 'npm',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
  })
}

const TASK_ID = '#1212'
const SANITIZED_ID = '_1212' // sanitizeTaskId('#1212')

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-stop-evidence-'))
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])

  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', configFor()))
  const hookPath = join(hooksDir, 'stop-evidence-guard.mjs')
  writeFileSync(hookPath, renderTemplate('claude/hooks/stop-evidence-guard.mjs.ejs', configFor()))

  // Seed a commit so HEAD resolves, then move onto a task/ branch.
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-m', 'init', '--no-gpg-sign'])
  git(dir, ['checkout', '-b', 'task/1212'])

  writeTaskStateFile(dir, { phase: 'green', tier: 'Standard', taskId: TASK_ID })

  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const sha = git(dir, ['rev-parse', 'HEAD'])
  return { dir, hookPath, branch, sha }
}

/** Append a commit and return the new HEAD sha (ancestor of nothing newer). */
function commitMore(dir: string, file = 'more.txt'): string {
  writeFileSync(join(dir, file), 'more\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-m', 'more', '--no-gpg-sign'])
  return git(dir, ['rev-parse', 'HEAD'])
}

interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use'
  text?: string
  thinking?: string
}

function writeTranscript(
  dir: string,
  lines: Array<{ type: string; blocks: ContentBlock[] }>,
): string {
  const p = join(dir, 'transcript.jsonl')
  const jsonl = lines
    .map((l) => JSON.stringify({ type: l.type, message: { role: l.type, content: l.blocks } }))
    .join('\n')
  writeFileSync(p, jsonl + '\n')
  return p
}

const CLAIM = 'task complete, ready to merge'

/** A transcript whose last assistant message plainly claims completion. */
function claimTranscript(dir: string): string {
  return writeTranscript(dir, [
    { type: 'user', blocks: [{ type: 'text', text: 'finish it' }] },
    { type: 'assistant', blocks: [{ type: 'text', text: CLAIM }] },
  ])
}

interface EvidenceOpts {
  branch?: string
  planSha?: string
  dispatchSha?: string
  gateSha?: string
  planVerdict?: string
  omit?: 'plan' | 'dispatch' | 'gate'
}

function writeCorrelatedEvidence(
  dir: string,
  branch: string,
  sha: string,
  opts: EvidenceOpts = {},
) {
  const b = opts.branch ?? branch
  const prDir = join(dir, '.arbiter', 'evidence', 'plan-review', SANITIZED_ID)
  mkdirSync(prDir, { recursive: true })
  mkdirSync(join(dir, '.arbiter'), { recursive: true })

  if (opts.omit !== 'plan') {
    writeFileSync(
      join(prDir, 'latest.json'),
      JSON.stringify({
        verdict: opts.planVerdict ?? 'PASS',
        branch: b,
        sha: opts.planSha ?? sha,
        planDigest: 'x'.repeat(64),
        tier: 'Standard',
      }),
    )
  }
  if (opts.omit !== 'dispatch') {
    writeFileSync(
      join(dir, '.arbiter', 'agents-dispatched.json'),
      JSON.stringify({ count: 4, branch: b, sha: opts.dispatchSha ?? sha }),
    )
  }
  if (opts.omit !== 'gate') {
    writeFileSync(
      join(dir, '.arbiter', 'gate-pass.json'),
      JSON.stringify({ head_sha: opts.gateSha ?? sha, branch: b, level: 'L2' }),
    )
  }
}

function runHook(
  hookPath: string,
  dir: string,
  input: { transcript_path?: string; stop_hook_active?: boolean },
) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd: dir, ...input }),
    encoding: 'utf-8',
  })
}

describe('stop-evidence-guard — empirical spawn (#1212)', () => {
  it('exits 0 when stop_hook_active is true (re-entry, no loop)', () => {
    const { dir, hookPath } = setup()
    try {
      const t = claimTranscript(dir)
      // No evidence at all — but re-entry guard must fire first.
      const r = runHook(hookPath, dir, { transcript_path: t, stop_hook_active: true })
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when all three evidence artifacts are valid and correlated', () => {
    const { dir, hookPath, branch, sha } = setup()
    try {
      writeCorrelatedEvidence(dir, branch, sha)
      const t = claimTranscript(dir)
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(0)
      expect(r.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when plan-review evidence is missing', () => {
    const { dir, hookPath, branch, sha } = setup()
    try {
      writeCorrelatedEvidence(dir, branch, sha, { omit: 'plan' })
      const t = claimTranscript(dir)
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/plan-review/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when gate-pass head_sha does not strictly equal HEAD', () => {
    const { dir, hookPath, branch, sha } = setup()
    try {
      // gate-pass pinned to the original sha; then commit again so HEAD moves.
      writeCorrelatedEvidence(dir, branch, sha)
      commitMore(dir)
      const t = claimTranscript(dir)
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/gate-pass/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when agents-dispatched sidecar branch is wrong', () => {
    const { dir, hookPath, branch, sha } = setup()
    try {
      writeCorrelatedEvidence(dir, branch, sha)
      // Overwrite dispatch sidecar with a foreign branch.
      writeFileSync(
        join(dir, '.arbiter', 'agents-dispatched.json'),
        JSON.stringify({ count: 4, branch: 'task/other', sha }),
      )
      const t = claimTranscript(dir)
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/dispatch/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when plan-review sha is not an ancestor of HEAD (divergent)', () => {
    const { dir, hookPath, branch, sha } = setup()
    try {
      // Build a sibling commit on main that is NOT an ancestor of task/1212 HEAD.
      // Stage ONLY sibling.txt — `git add -A` would sweep the untracked fixture
      // files (status.json, evidence) into main's tree and `checkout task/1212`
      // would then delete them, disarming the phase guard.
      git(dir, ['checkout', 'main'])
      writeFileSync(join(dir, 'sibling.txt'), 'sib\n')
      git(dir, ['add', 'sibling.txt'])
      git(dir, ['commit', '-m', 'sibling', '--no-gpg-sign'])
      const siblingSha = git(dir, ['rev-parse', 'HEAD'])
      git(dir, ['checkout', 'task/1212'])
      writeCorrelatedEvidence(dir, branch, sha, { planSha: siblingSha })
      const t = claimTranscript(dir)
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/plan-review/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when plan-review verdict is not PASS', () => {
    const { dir, hookPath, branch, sha } = setup()
    try {
      writeCorrelatedEvidence(dir, branch, sha, { planVerdict: 'FAIL' })
      const t = claimTranscript(dir)
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/plan-review/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when the transcript has no completion claim', () => {
    const { dir, hookPath } = setup()
    try {
      // No evidence at all, but no claim → stand down.
      const t = writeTranscript(dir, [
        { type: 'assistant', blocks: [{ type: 'text', text: 'still working on the parser' }] },
      ])
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when the transcript path is missing/unreadable', () => {
    const { dir, hookPath } = setup()
    try {
      const r = runHook(hookPath, dir, { transcript_path: join(dir, 'nope.jsonl') })
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 on a non-task/ship branch even with a completion claim', () => {
    const { dir, hookPath } = setup()
    try {
      git(dir, ['checkout', '-b', 'feature/x'])
      const t = claimTranscript(dir)
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when phase is already complete', () => {
    const { dir, hookPath } = setup()
    try {
      writeTaskStateFile(dir, { phase: 'complete', tier: 'Standard', taskId: TASK_ID })
      const t = claimTranscript(dir)
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects a claim in an earlier text block when the last block is thinking-only', () => {
    const { dir, hookPath, branch, sha } = setup()
    try {
      // Missing evidence so a detected claim → exit 2; proves the parser scans
      // ALL text blocks of the last assistant message, not just the final block.
      writeCorrelatedEvidence(dir, branch, sha, { omit: 'gate' })
      const t = writeTranscript(dir, [
        {
          type: 'assistant',
          blocks: [
            { type: 'thinking', thinking: 'let me check the gate' },
            { type: 'text', text: CLAIM },
            { type: 'thinking', thinking: 'done now' },
          ],
        },
      ])
      const r = runHook(hookPath, dir, { transcript_path: t })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/gate-pass/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
