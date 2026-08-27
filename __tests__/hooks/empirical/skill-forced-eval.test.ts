import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { renderTemplate } from '../../../src/utils/render.js'
import { makeConfig, writeTaskStateFile } from '../../helpers.js'

const STARTED_AT = '2026-08-27T19:00:00.000Z'
const SESSION_ID = 'session-2383'
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'] as const

function testHome(dir: string) {
  return join(dir, 'home')
}

function encodeProjectPath(path: string) {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

function transcriptPath(dir: string) {
  return join(
    testHome(dir),
    '.claude',
    'projects',
    encodeProjectPath(resolve(dir)),
    `${SESSION_ID}.jsonl`,
  )
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-skill-forced-eval-'))
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
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

  // Exercise the materialized self copy and the real dispatcher against the same fixture.
  writeFileSync(
    join(hooksDir, 'skill-forced-eval-self.mjs'),
    readFileSync(join(process.cwd(), '.claude/hooks/skill-forced-eval.mjs')),
  )
  writeFileSync(
    join(hooksDir, 'hooks.mjs'),
    readFileSync(join(process.cwd(), '.claude/hooks/hooks.mjs')),
  )
  writeFileSync(
    join(hooksDir, 'guard-task-completion.mjs'),
    readFileSync(join(process.cwd(), '.claude/hooks/guard-task-completion.mjs')),
  )
  writeTaskStateFile(dir, { phase: 'plan', taskId: '#2383', tier: 'Standard' })
  return {
    dir,
    hookPath,
    selfHookPath: join(hooksDir, 'skill-forced-eval-self.mjs'),
    dispatcherPath: join(hooksDir, 'hooks.mjs'),
  }
}

function setPhase(dir: string, phase: string, startedAt = STARTED_AT) {
  const statusPath = join(dir, '.claude', '.task', 'status.json')
  const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as Record<string, unknown>
  status.phase = phase
  status.timestamps = { [phase]: startedAt }
  writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n')
}

type ResultShape = Record<string, unknown>

function message(type: string, timestamp: string | undefined, content: unknown[]) {
  return { type, ...(timestamp ? { timestamp } : {}), message: { role: type, content } }
}

function toolUse(
  name: string,
  id: string,
  timestamp = '2026-08-27T19:00:01.000Z',
  input: unknown = {},
) {
  return message('assistant', timestamp, [{ type: 'tool_use', id, name, input }])
}

function toolResult(id: string, result: ResultShape = { is_error: false }) {
  return message('user', '2026-08-27T19:00:03.000Z', [
    { type: 'tool_result', tool_use_id: id, ...result },
  ])
}

function writeTranscript(
  dir: string,
  options: {
    includeEdit?: boolean
    editTool?: string
    editId?: string
    editTimestamp?: string
    editResult?: ResultShape
    editBeforeSkill?: boolean
    skillTimestamp?: string
    skillName?: string
    skillId?: string
    skillInput?: unknown
    skillResult?: ResultShape
  } = {},
) {
  const {
    includeEdit = false,
    editTool = 'Edit',
    editId = 'edit-1',
    editTimestamp = '2026-08-27T19:00:02.000Z',
    editResult = { is_error: false },
    editBeforeSkill = false,
    skillTimestamp,
    skillName = 'Skill',
    skillId = 'skill-1',
    skillInput = { skill: 'tdd', args: '#2383' },
    skillResult = { is_error: false },
  } = options
  const lines: object[] = []
  const edit = toolUse(editTool, editId, editTimestamp, { file_path: 'src/a.ts' })
  const editResultLine = toolResult(editId, editResult)
  if (includeEdit && editBeforeSkill) lines.push(edit, editResultLine)
  if (skillTimestamp !== undefined) {
    lines.push(
      toolUse(skillName, skillId, skillTimestamp, skillInput),
      toolResult(skillId, skillResult),
    )
  } else if (!includeEdit) {
    lines.push(
      message('assistant', '2026-08-27T19:00:30.000Z', [{ type: 'text', text: 'I used tdd.' }]),
    )
  }
  if (includeEdit && !editBeforeSkill) lines.push(edit, editResultLine)
  const path = transcriptPath(dir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return path
}

function writeRawTranscript(dir: string, lines: unknown[]) {
  const path = transcriptPath(dir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n',
  )
  return path
}

function hookInput(dir: string, transcript?: string, prompt = 'continue implementation') {
  return JSON.stringify({
    session_id: SESSION_ID,
    cwd: dir,
    prompt,
    ...(transcript === undefined ? {} : { transcript_path: transcript }),
  })
}

function run(
  hookPath: string,
  dir: string,
  transcript?: string,
  prompt = 'continue implementation',
  inputOverride?: string,
  args: string[] = [],
) {
  return spawnSync('node', [hookPath, ...args], {
    cwd: dir,
    input:
      inputOverride ?? (transcript === undefined ? undefined : hookInput(dir, transcript, prompt)),
    encoding: 'utf-8',
    timeout: 5000,
    env: { ...process.env, HOME: testHome(dir) },
  })
}

describe('skill-forced-eval — empirical verification gate (#2383)', () => {
  it.each(['red', 'green', 'refactor'])(
    'AC-2383.2 blocks %s without successful Skill evidence',
    (phase) => {
      const { dir, hookPath } = setup()
      try {
        setPhase(dir, phase)
        const result = run(hookPath, dir, writeTranscript(dir, { includeEdit: true }))
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
          writeTranscript(dir, {
            includeEdit: true,
            skillTimestamp: '2026-08-27T19:00:01.000Z',
            skillResult: { is_error: false },
          }),
        ).status,
      ).toBe(0)
      expect(
        run(
          hookPath,
          dir,
          writeTranscript(dir, {
            includeEdit: true,
            skillTimestamp: '2026-08-27T19:00:01.000Z',
            skillResult: { is_error: true },
          }),
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
          writeTranscript(dir, {
            includeEdit: true,
            skillTimestamp: '2026-08-27T18:59:59.000Z',
          }),
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
        expect(run(hookPath, dir, writeTranscript(dir, { includeEdit: true })).status).toBe(0)
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
        run(unknown.hookPath, unknown.dir, writeTranscript(unknown.dir, { includeEdit: true }))
          .status,
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
          writeTranscript(dir, {
            includeEdit: true,
            editBeforeSkill: true,
            skillTimestamp: '2026-08-27T19:00:01.000Z',
          }),
        ).status,
      ).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    {
      label: 'tool call outside an assistant message',
      lines: [
        message('user', STARTED_AT, [
          { type: 'tool_use', id: 'skill-1', name: 'Skill', input: { skill: 'tdd' } },
        ]),
        toolResult('skill-1'),
        toolUse('Edit', 'edit-1'),
        toolResult('edit-1'),
      ],
    },
    {
      label: 'tool result outside a user message',
      lines: [
        toolUse('Edit', 'edit-1'),
        message('assistant', '2026-08-27T19:00:03.000Z', [
          { type: 'tool_result', tool_use_id: 'edit-1', is_error: false },
        ]),
      ],
    },
  ])('rejects $label', ({ lines }) => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      expect(run(hookPath, dir, writeRawTranscript(dir, lines)).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(EDIT_TOOLS)('recognises a successful %s as an implementation edit', (editTool) => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      expect(
        run(
          hookPath,
          dir,
          writeTranscript(dir, { includeEdit: true, editTool, skillTimestamp: STARTED_AT }),
        ).status,
      ).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('executes self, rendered, and dispatcher paths with equivalent outcomes', () => {
    const { dir, hookPath, selfHookPath, dispatcherPath } = setup()
    try {
      setPhase(dir, 'green')
      const blockedTranscript = writeTranscript(dir, { includeEdit: true })
      const blocked = [
        run(hookPath, dir, blockedTranscript),
        run(selfHookPath, dir, blockedTranscript),
        run(dispatcherPath, dir, blockedTranscript, 'continue implementation', undefined, [
          'UserPromptSubmit',
        ]),
      ]
      expect(blocked.map((result) => [result.status, result.stderr])).toEqual([
        [2, blocked[0].stderr],
        [2, blocked[0].stderr],
        [2, blocked[0].stderr],
      ])

      const passingTranscript = writeTranscript(dir, {
        includeEdit: true,
        skillTimestamp: STARTED_AT,
      })
      const passing = [
        run(hookPath, dir, passingTranscript),
        run(selfHookPath, dir, passingTranscript),
        run(dispatcherPath, dir, passingTranscript, 'continue implementation', undefined, [
          'UserPromptSubmit',
        ]),
      ]
      expect(passing.map((result) => [result.status, result.stderr])).toEqual([
        [0, ''],
        [0, ''],
        [0, ''],
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-2383.2 allows a no-edit prompt and exact /tdd remediation', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'red')
      expect(run(hookPath, dir, writeTranscript(dir)).status).toBe(0)
      expect(run(hookPath, dir, writeTranscript(dir, { includeEdit: true }), '/tdd').status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let /tdd bypass an invalid host envelope', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      const transcript = writeTranscript(dir, { includeEdit: true })
      expect(
        run(hookPath, dir, transcript, '/tdd', JSON.stringify({ prompt: '/tdd' })).status,
      ).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let /tdd bypass corrupt task state', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      writeFileSync(join(dir, '.claude/.task/status.json'), '{not-json')
      expect(
        run(
          hookPath,
          dir,
          undefined,
          '/tdd',
          JSON.stringify({ session_id: SESSION_ID, prompt: '/tdd' }),
        ).status,
      ).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    { label: 'non-object stdin', input: '[]' },
    { label: 'missing session id', input: JSON.stringify({ prompt: 'continue' }) },
    {
      label: 'invalid result flag',
      options: {
        includeEdit: true,
        skillTimestamp: STARTED_AT,
        skillResult: { is_error: 'false' },
      },
    },
    { label: 'result before use', raw: true },
  ])('blocks parseable malformed evidence: $label', ({ input, options, raw }) => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      const path = raw
        ? writeRawTranscript(dir, [toolResult('edit-1'), toolUse('Edit', 'edit-1')])
        : writeTranscript(dir, options)
      const result = run(hookPath, dir, path, 'continue implementation', input)
      expect(result.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('blocks malformed interior records but tolerates a partial trailing record', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      const valid = writeTranscript(dir, { includeEdit: true, skillTimestamp: STARTED_AT })
      const contents = readFileSync(valid, 'utf-8').trimEnd().split('\n')
      const interior = writeRawTranscript(dir, [contents[0], 'not-json', ...contents.slice(1)])
      expect(run(hookPath, dir, interior).status).toBe(2)
      const trailing = writeRawTranscript(dir, [
        ...contents.map((line) => JSON.parse(line)),
        'not-json',
      ])
      expect(run(hookPath, dir, trailing).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each([
    {
      label: 'wrong skill',
      options: {
        includeEdit: true,
        skillTimestamp: STARTED_AT,
        skillInput: { skill: 'verification' },
      },
    },
    { label: 'duplicate tool id', raw: true },
    { label: 'invalid timestamp', options: { includeEdit: true, editTimestamp: 'not-a-date' } },
  ])('blocks $label', ({ options, raw }) => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      const path = raw
        ? writeRawTranscript(dir, [toolUse('Edit', 'edit-1'), toolUse('Edit', 'edit-1')])
        : writeTranscript(dir, options)
      expect(run(hookPath, dir, path).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('blocks unsafe, missing-phase, and oversized transcript inputs', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      const unsafe = join(dir, 'forged.jsonl')
      writeFileSync(unsafe, '{}\n')
      expect(run(hookPath, dir, unsafe).status).toBe(2)

      const missingPhase = JSON.parse(readFileSync(join(dir, '.claude/.task/status.json'), 'utf-8'))
      missingPhase.timestamps = {}
      writeFileSync(join(dir, '.claude/.task/status.json'), JSON.stringify(missingPhase))
      expect(run(hookPath, dir, unsafe).status).toBe(2)

      setPhase(dir, 'green')
      const oversized = transcriptPath(dir)
      mkdirSync(dirname(oversized), { recursive: true })
      writeFileSync(oversized, 'x'.repeat(8 * 1024 * 1024 + 1))
      expect(run(hookPath, dir, oversized).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stands down when the expected transcript is absent or symlinked only by explicit host failure', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      const missing = transcriptPath(dir)
      expect(run(hookPath, dir, missing).status).toBe(0)

      const target = join(dir, 'real.jsonl')
      writeFileSync(target, '{}\n')
      mkdirSync(dirname(missing), { recursive: true })
      symlinkSync(target, missing)
      expect(run(hookPath, dir, missing).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
