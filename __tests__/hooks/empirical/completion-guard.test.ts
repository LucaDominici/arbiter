import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

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

  writeTaskStateFile(dir, { phase, tier: 'Standard' })
  writeFileSync(join(dir, '.agents-dispatched'), '4\n')

  return { dir, hookPath }
}

function runHook(
  hookPath: string,
  dir: string,
  assistantText: string,
  options: { ownerPrompt?: string; stopHookActive?: boolean } = {},
) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
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

  it('still blocks a repeated unsupported claim when stop_hook_active is true', () => {
    const { dir, hookPath } = setup('green')
    try {
      expect(
        runHook(hookPath, dir, 'task complete, ready to merge', { stopHookActive: true }).status,
      ).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
