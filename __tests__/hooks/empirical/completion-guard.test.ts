import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

const TASK_ID = 'completion-guard-task'

function writeSidecar(
  dir: string,
  value: { count: number; taskId?: string; branch?: string; sha?: string },
) {
  const sidecarDir = join(dir, '.arbiter')
  mkdirSync(sidecarDir, { recursive: true })
  writeFileSync(
    join(sidecarDir, 'agents-dispatched.json'),
    JSON.stringify({
      taskId: TASK_ID,
      branch: 'task/x',
      sha: 'deadbeef',
      ...value,
    }),
  )
}

function withTreatment(dir: string, finalReviewers: number | null) {
  const statusPath = join(dir, '.claude', '.task', 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf-8'))
  if (finalReviewers === null) {
    delete status.treatment
  } else {
    status.treatment = {
      version: 1,
      requestedTier: 'Standard',
      tier: 'Standard',
      sensitive: false,
      planDepth: 'brief',
      finalReviewers,
      acceptanceFitReviewers: 1,
      reviewerVerticals: [],
      modelCapability: 'capable',
      qualifiedNarrow: false,
      signalsHash: '0'.repeat(64),
      reasons: [],
    }
  }
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n')
}

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

const PRODUCERS = ['self', 'emitted'] as const
const SESSION_ID = 'completion-stop-session'

function setup(phase: string, producer: (typeof PRODUCERS)[number] = 'emitted') {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-completion-guard-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })

  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', configFor()))

  const hookPath = join(hooksDir, 'guard-task-completion.mjs')
  writeFileSync(
    hookPath,
    producer === 'self'
      ? readFileSync(join(process.cwd(), '.claude/hooks/guard-task-completion.mjs'))
      : renderTemplate('claude/hooks/guard-task-completion.mjs.ejs', configFor()),
  )

  writeTaskStateFile(dir, { phase, tier: 'Standard', taskId: TASK_ID })

  return { dir, hookPath }
}

function runHook(
  hookPath: string,
  dir: string,
  assistantText: string,
  options: { ownerPrompt?: string; stopHookActive?: boolean; sessionId?: string } = {},
) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: options.sessionId ?? SESSION_ID,
      cwd: dir,
      prompt: options.ownerPrompt ?? 'please continue',
      last_assistant_message: assistantText,
      stop_hook_active: options.stopHookActive ?? false,
    }),
    encoding: 'utf-8',
    timeout: 5000,
  })
}

function transcriptPath(dir: string) {
  const home = join(dir, 'home')
  return {
    home,
    path: join(
      home,
      '.claude',
      'projects',
      resolve(dir).replace(/[^A-Za-z0-9]/g, '-'),
      `${SESSION_ID}.jsonl`,
    ),
  }
}

describe('completion-guard — empirical spawn', () => {
  it.each(PRODUCERS)(
    '%s exits 2 for a benign owner prompt followed by an assistant completion claim',
    (producer) => {
      const { dir, hookPath } = setup('green', producer)
      try {
        const result = runHook(hookPath, dir, 'task complete, ready to merge')

        expect(result.status).toBe(2)
        expect(result.stderr).toContain('COMPLETION GUARD')
        expect(result.stdout).toBe('')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it.each(PRODUCERS)(
    '%s ignores completion language in the owner prompt when the assistant status is benign',
    (producer) => {
      const { dir, hookPath } = setup('green', producer)
      try {
        const result = runHook(hookPath, dir, 'still working on the parser', {
          ownerPrompt: 'task complete, ready to merge',
        })

        expect(result.status).toBe(0)
        expect(result.stderr).toBe('')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('exits 2 and writes to stderr on completion claim during red phase', () => {
    const { dir, hookPath } = setup('red')
    try {
      const result = runHook(hookPath, dir, 'task complete, ready to merge')

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('COMPLETION GUARD')
      expect(result.stdout).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 on a paraphrased completion claim (regex covers paraphrases, #A11 drift)', () => {
    const { dir, hookPath } = setup('green')
    try {
      const result = runHook(hookPath, dir, 'the implementation is done, everything shipped')

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('COMPLETION GUARD')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 on benign assistant status (no completion claim)', () => {
    const { dir, hookPath } = setup('red')
    try {
      const result = runHook(hookPath, dir, 'still working on the parser')

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 and writes to stderr on completion claim during verification', () => {
    const { dir, hookPath } = setup('verification')
    try {
      const result = runHook(hookPath, dir, 'task complete, ready to merge')

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('COMPLETION GUARD')
      expect(result.stdout).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when phase is complete (completion allowed)', () => {
    const { dir, hookPath } = setup('complete')
    try {
      const result = runHook(hookPath, dir, 'task complete, ready to merge')

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the latest bound transcript assistant text', () => {
    const { dir, hookPath } = setup('green')
    try {
      const transcript = transcriptPath(dir)
      mkdirSync(dirname(transcript.path), { recursive: true })
      writeFileSync(
        transcript.path,
        `${JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'task complete' }] },
        })}\n`,
      )
      const result = spawnSync('node', [hookPath], {
        cwd: dir,
        input: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: SESSION_ID,
          cwd: dir,
          prompt: 'please continue',
          transcript_path: transcript.path,
        }),
        encoding: 'utf-8',
        env: { ...process.env, HOME: transcript.home },
        timeout: 5000,
      })
      expect(result.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats an explicitly empty last_assistant_message as authoritative', () => {
    const { dir, hookPath } = setup('green')
    try {
      expect(
        runHook(hookPath, dir, '', { ownerPrompt: 'task complete, ready to merge' }).status,
      ).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // AC-2885.1: negation/quoting must not trip the guard on a status-only message.
  it.each(PRODUCERS)('AC-1 %s: negated claim in a status sentence is not blocked', (producer) => {
    const { dir, hookPath } = setup('green', producer)
    try {
      const result = runHook(
        hookPath,
        dir,
        'Current state (not complete — phase remains refactor): the writer lane stops here.',
      )
      expect(result.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(PRODUCERS)('AC-1 %s: quoted trigger phrase is not blocked', (producer) => {
    const { dir, hookPath } = setup('green', producer)
    try {
      const result = runHook(
        hookPath,
        dir,
        'That phrasing ("task complete") tripped a guard; I had not claimed lifecycle completion.',
      )
      expect(result.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-1: adjectival "shipped diff" is not a claim', () => {
    const { dir, hookPath } = setup('refactor', 'self')
    try {
      const result = runHook(hookPath, dir, 'Not a defect in the shipped diff.')
      expect(result.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // AC-2885.3: regression corpus — real claims stay blocked.
  it.each([
    'task complete, ready to merge',
    'Task complete for this lane.',
    'not only is the task complete but merged',
    'the task is complete — no, really',
    'as agreed: "task complete", so I am wrapping up',
  ])('AC-3 still blocks: %s', (text) => {
    const { dir, hookPath } = setup('green')
    try {
      const result = runHook(hookPath, dir, text)
      expect(result.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-3: claim with treatment.finalReviewers=1 and sidecar count=1 but phase=green still exits 2', () => {
    const { dir, hookPath } = setup('green')
    try {
      writeSidecar(dir, { count: 1 })
      withTreatment(dir, 1)
      const result = runHook(hookPath, dir, 'task complete, ready to merge')
      expect(result.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // AC-2885.2: reviewer-count floor from persisted treatment, not a hardcoded 4.
  it('AC-2: stderr floor line reads "agents-dispatched: 1 (minimum 1 for treatment Standard)" when treatment.finalReviewers=1', () => {
    const { dir, hookPath } = setup('green')
    try {
      writeSidecar(dir, { count: 0 })
      withTreatment(dir, 1)
      const result = runHook(hookPath, dir, 'task complete, ready to merge')
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('agents-dispatched: 0 (minimum 1 for treatment Standard)')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-2: stderr never contains "minimum 4" when a treatment is persisted', () => {
    const { dir, hookPath } = setup('green')
    try {
      writeSidecar(dir, { count: 0 })
      withTreatment(dir, 1)
      const result = runHook(hookPath, dir, 'task complete, ready to merge')
      expect(result.stderr).not.toContain('minimum 4')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-2: sidecar with a different taskId counts as 0', () => {
    const { dir, hookPath } = setup('green')
    try {
      writeSidecar(dir, { count: 5, taskId: 'some-other-task' })
      withTreatment(dir, 1)
      const result = runHook(hookPath, dir, 'task complete, ready to merge')
      expect(result.stderr).toContain('agents-dispatched: 0 (minimum 1 for treatment Standard)')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-2: no treatment persisted -> stderr says "ship treatment: not persisted" and no numeric floor', () => {
    const { dir, hookPath } = setup('green')
    try {
      const result = runHook(hookPath, dir, 'task complete, ready to merge')
      expect(result.stderr).toContain('ship treatment: not persisted')
      expect(result.stderr).not.toMatch(/minimum \d+/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // AC-2885.4: re-entry — rewrite of the old blanket "still blocks on re-entry" case.
  it('AC-4: same claim, same state, stop_hook_active=true -> 0 after one block', () => {
    const { dir, hookPath } = setup('green')
    try {
      const first = runHook(hookPath, dir, 'task complete, ready to merge')
      expect(first.status).toBe(2)
      const second = runHook(hookPath, dir, 'task complete, ready to merge', {
        stopHookActive: true,
      })
      expect(second.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-4: stop_hook_active=true with NO prior marker -> 2', () => {
    const { dir, hookPath } = setup('green')
    try {
      const result = runHook(hookPath, dir, 'task complete, ready to merge', {
        stopHookActive: true,
      })
      expect(result.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-4: stop_hook_active=true but message changed -> 2', () => {
    const { dir, hookPath } = setup('green')
    try {
      const first = runHook(hookPath, dir, 'task complete, ready to merge')
      expect(first.status).toBe(2)
      const second = runHook(hookPath, dir, 'task complete for real this time', {
        stopHookActive: true,
      })
      expect(second.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-4: stop_hook_active=true but phase changed since marker -> 2', () => {
    const { dir, hookPath } = setup('green')
    try {
      const first = runHook(hookPath, dir, 'task complete, ready to merge')
      expect(first.status).toBe(2)
      writeTaskStateFile(dir, { phase: 'refactor', tier: 'Standard', taskId: TASK_ID })
      const second = runHook(hookPath, dir, 'task complete, ready to merge', {
        stopHookActive: true,
      })
      expect(second.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-4: marker of another session_id is ignored -> 2', () => {
    const { dir, hookPath } = setup('green')
    try {
      const first = runHook(hookPath, dir, 'task complete, ready to merge')
      expect(first.status).toBe(2)
      const second = runHook(hookPath, dir, 'task complete, ready to merge', {
        stopHookActive: true,
        sessionId: 'a-different-session',
      })
      expect(second.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
