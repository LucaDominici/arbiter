import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

const STARTED_AT = '2026-08-27T19:00:00.000Z'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-skill-forced-eval-'))
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  const config = makeConfig(dir, {
    language: 'typescript',
    governanceLevel: 'L2',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    formatCommand: 'npx prettier --write',
  })
  writeFileSync(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', config))
  const hookPath = join(hooksDir, 'skill-forced-eval.mjs')
  writeFileSync(hookPath, renderTemplate('claude/hooks/skill-forced-eval.mjs.ejs', config))
  writeTaskStateFile(dir, { phase: 'plan', taskId: '#2383', tier: 'Standard' })
  return { dir, hookPath }
}

function setPhase(dir: string, phase: string, startedAt = STARTED_AT) {
  const statusPath = join(dir, '.claude', '.task', 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as Record<string, unknown>
  status.phase = phase
  status.timestamps = { [phase]: startedAt }
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n')
}

function writeTranscript(
  dir: string,
  invocationAt?: string,
  result: { is_error?: boolean } = { is_error: false },
  includeEdit = false,
  editBeforeSkill = false,
): string {
  const path = join(dir, 'session.jsonl')
  const lines: object[] = []
  const edit = {
    type: 'assistant',
    timestamp: '2026-08-27T19:00:02.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: 'src/a.ts' } }],
    },
  }
  const editResult = {
    type: 'user',
    timestamp: '2026-08-27T19:00:03.000Z',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'edit-1', is_error: false }],
    },
  }
  if (includeEdit && editBeforeSkill) lines.push(edit, editResult)
  if (invocationAt === undefined) {
    lines.push({
      type: 'assistant',
      timestamp: '2026-08-27T19:00:30.000Z',
      message: {
        role: 'assistant',
        content: includeEdit
          ? [{ type: 'text', text: 'I edited the implementation.' }]
          : [{ type: 'text', text: 'I used tdd.' }],
      },
    })
  } else {
    lines.push({
      type: 'assistant',
      timestamp: invocationAt,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'skill-1',
            name: 'Skill',
            input: { skill: 'tdd', args: '#2383' },
          },
        ],
      },
    })
    lines.push({
      type: 'user',
      timestamp: '2026-08-27T19:01:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'skill-1', ...result }],
      },
    })
    if (includeEdit && !editBeforeSkill) lines.push(edit, editResult)
  }
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return path
}

function run(
  hookPath: string,
  dir: string,
  transcriptPath?: string,
  prompt = 'continue implementation',
) {
  return spawnSync('node', [hookPath], {
    cwd: dir,
    input:
      transcriptPath === undefined
        ? undefined
        : JSON.stringify({ prompt, transcript_path: transcriptPath }),
    encoding: 'utf-8',
    timeout: 5000,
  })
}

describe('skill-forced-eval — empirical verification gate (#2383)', () => {
  it.each(['red', 'green', 'refactor'])(
    'AC-2383.2 blocks %s without successful Skill evidence',
    (phase) => {
      const { dir, hookPath } = setup()
      try {
        setPhase(dir, phase)
        const result = run(
          hookPath,
          dir,
          writeTranscript(dir, undefined, { is_error: false }, true),
        )
        expect(result.status).toBe(2)
        expect(result.stderr).toMatch(/tdd|Skill|phase/i)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('AC-2383.1 accepts a current-phase Skill call only after it succeeds', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      expect(
        run(
          hookPath,
          dir,
          writeTranscript(dir, '2026-08-27T19:00:01.000Z', { is_error: false }, true),
        ).status,
      ).toBe(0)
      expect(
        run(
          hookPath,
          dir,
          writeTranscript(dir, '2026-08-27T19:00:01.000Z', { is_error: true }, true),
        ).status,
      ).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-2383.1 rejects a successful call from before the current phase', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      expect(
        run(
          hookPath,
          dir,
          writeTranscript(dir, '2026-08-27T18:59:59.000Z', { is_error: false }, true),
        ).status,
      ).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(['preflight', 'plan', 'red-team-review', 'red-team-rework', 'verification', 'complete'])(
    'AC-2383.2 stands down in %s',
    (phase) => {
      const { dir, hookPath } = setup()
      try {
        setPhase(dir, phase)
        expect(
          run(hookPath, dir, writeTranscript(dir, undefined, { is_error: false }, true)).status,
        ).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('AC-2383.3 stands down on unreadable stdin and unknown phase', () => {
    const unreadable = setup()
    try {
      setPhase(unreadable.dir, 'refactor')
      expect(run(unreadable.hookPath, unreadable.dir).status).toBe(0)
    } finally {
      rmSync(unreadable.dir, { recursive: true, force: true })
    }

    const unknown = setup()
    try {
      setPhase(unknown.dir, 'unknown')
      expect(
        run(
          unknown.hookPath,
          unknown.dir,
          writeTranscript(unknown.dir, undefined, { is_error: false }, true),
        ).status,
      ).toBe(0)
    } finally {
      rmSync(unknown.dir, { recursive: true, force: true })
    }
  })

  it('AC-2383.1 rejects an edit that precedes the Skill result', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'refactor')
      expect(
        run(
          hookPath,
          dir,
          writeTranscript(dir, '2026-08-27T19:00:01.000Z', { is_error: false }, true, true),
        ).status,
      ).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-2383.2 allows a no-edit prompt and exact /tdd remediation', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'red')
      expect(run(hookPath, dir, writeTranscript(dir)).status).toBe(0)
      expect(
        run(hookPath, dir, writeTranscript(dir, undefined, { is_error: false }, true), '/tdd')
          .status,
      ).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
