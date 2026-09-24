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
  for (const name of [
    'guard-done-evidence.mjs',
    'stop-evidence-guard.mjs',
    'stop-finding-loss.mjs',
  ]) {
    writeFileSync(join(hooksDir, name), readFileSync(join(process.cwd(), '.claude/hooks', name)))
  }
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

function hookInput(
  dir: string,
  transcript?: string,
  prompt?: string,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    cwd: dir,
    last_assistant_message: 'Implementation is still in progress.',
    ...(prompt === undefined ? {} : { prompt }),
    ...(transcript === undefined ? {} : { transcript_path: transcript }),
    ...extra,
  })
}

function run(
  hookPath: string,
  dir: string,
  transcript?: string,
  prompt?: string,
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

  it.each(['preflight', 'plan', 'verification', 'complete'])(
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

  it('#2861 AC-4 a successful Skill(tdd) after the edit does not forgive it without a receipt', () => {
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
        run(dispatcherPath, dir, blockedTranscript, undefined, undefined, ['Stop']),
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
        run(dispatcherPath, dir, passingTranscript, undefined, undefined, ['Stop']),
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

  it('AC-2383.2 allows no-edit Stop but does not exempt an owner /tdd prompt after an edit', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'red')
      expect(run(hookPath, dir, writeTranscript(dir)).status).toBe(0)
      expect(run(hookPath, dir, writeTranscript(dir, { includeEdit: true }), '/tdd').status).toBe(2)
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

  it('still blocks the offending edit when stop_hook_active is true', () => {
    const { dir, hookPath } = setup()
    try {
      setPhase(dir, 'green')
      const transcript = writeTranscript(dir, { includeEdit: true })
      const result = run(
        hookPath,
        dir,
        transcript,
        undefined,
        hookInput(dir, transcript, undefined, { stop_hook_active: true }),
      )
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/successful Skill\(tdd\)/i)
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

describe('skill-forced-eval — recoverable gate (#2861)', () => {
  const EDIT_AT = '2026-08-27T19:00:02.000Z'

  function editLines(id: string, input: unknown, tool = 'Edit') {
    return [toolUse(tool, id, EDIT_AT, input), toolResult(id)]
  }

  function skillLines(id: string, result: ResultShape = { is_error: false }) {
    return [
      toolUse('Skill', id, '2026-08-27T19:00:04.000Z', { skill: 'tdd', args: '#2383' }),
      toolResult(id, result),
    ]
  }

  function patchStatus(dir: string, fields: Record<string, unknown>) {
    const statusPath = join(dir, '.claude', '.task', 'status.json')
    const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as Record<string, unknown>
    writeFileSync(statusPath, JSON.stringify({ ...status, ...fields }, null, 2) + '\n')
  }

  function setPlan(dir: string, plan: string) {
    patchStatus(dir, { plan })
  }

  function git(dir: string, args: string[]) {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }

  /** Creates the edited file so the exemption can classify its real path. */
  function touch(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'x\n')
    return path
  }

  /** A branch carrying a RED test commit for #2383 and, optionally, its committed receipt. */
  function recordRed(
    dir: string,
    receipt: { commit: boolean; log?: string; patch?: Record<string, unknown> },
  ) {
    const env = ['-c', 'user.name=t', '-c', 'user.email=t@example.com']
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(
      join(dir, 'scripts', 'check-tdd-evidence.mjs'),
      readFileSync(join(process.cwd(), 'src/templates/scripts/check-tdd-evidence.mjs.ejs')),
    )
    writeFileSync(join(dir, 'README.md'), 'base\n')
    git(dir, ['add', 'README.md', 'scripts/check-tdd-evidence.mjs'])
    git(dir, [...env, 'commit', '-m', 'chore: base'])
    git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.test.ts'), 'test("red", () => { throw 1 })\n')
    git(dir, ['add', 'src/a.test.ts'])
    git(dir, [...env, 'commit', '-m', 'test(#2383): red'])
    const evidence = join(dir, '.arbiter', 'evidence', 'tdd', '#2383.json')
    mkdirSync(dirname(evidence), { recursive: true })
    writeFileSync(
      evidence,
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#2383',
        test_path: 'src/a.test.ts',
        test_cwd: '.',
        test_commit_sha: git(dir, ['rev-parse', 'HEAD']),
        test_run_log: receipt.log ?? ' FAIL  src/a.test.ts > red\n',
        observed_failure: 'FAIL  src/a.test.ts',
        recorded_at: '2026-08-27T18:59:00.000Z',
        test_command: ['npx', 'vitest', 'run', 'src/a.test.ts'],
        ...receipt.patch,
      }),
    )
    if (receipt.commit) {
      git(dir, ['add', '-f', '.arbiter/evidence/tdd/#2383.json'])
      git(dir, [...env, 'commit', '-m', 'test(#2383): record red'])
    }
  }

  function withRepo(fn: (ctx: ReturnType<typeof setup>) => void) {
    const ctx = setup()
    try {
      fn(ctx)
    } finally {
      rmSync(ctx.dir, { recursive: true, force: true })
    }
  }

  it.each([
    { label: 'absolute docs/** path', path: (dir: string) => join(dir, 'docs', 'x.ts') },
    { label: 'absolute *.md path', path: (dir: string) => join(dir, 'PLAN.md') },
    { label: 'relative *.md path', path: () => 'notes/review.md' },
    {
      label: 'active plan file',
      path: (dir: string) => join(dir, '.arbiter', 'plans', '2383.plan'),
    },
  ])('AC-2 does not count an edit to the $label', ({ path }) =>
    withRepo(({ dir, hookPath, selfHookPath }) => {
      setPhase(dir, 'refactor')
      setPlan(dir, '.arbiter/plans/2383.plan')
      touch(resolve(dir, path(dir)))
      const transcript = writeRawTranscript(dir, editLines('edit-1', { file_path: path(dir) }))
      expect(run(hookPath, dir, transcript).status).toBe(0)
      expect(run(selfHookPath, dir, transcript).status).toBe(0)
    }),
  )

  it('AC-2 does not count a NotebookEdit under docs/**', () =>
    withRepo(({ dir, hookPath }) => {
      setPhase(dir, 'green')
      const transcript = writeRawTranscript(
        dir,
        editLines('edit-1', { notebook_path: touch(join(dir, 'docs', 'n.ipynb')) }, 'NotebookEdit'),
      )
      expect(run(hookPath, dir, transcript).status).toBe(0)
    }))

  it.each([
    {
      label: 'src/docs/** is not docs/**',
      input: (dir: string) => ({ file_path: join(dir, 'src', 'docs', 'x.ts') }),
    },
    {
      label: 'a path outside the repo',
      input: (dir: string) => ({ file_path: join(dir, '..', 'x.md') }),
    },
    { label: 'a missing file_path', input: () => ({}) },
    { label: 'a non-string file_path', input: () => ({ file_path: 7 }) },
    {
      label: 'a docs edit next to a source edit',
      input: (dir: string) => ({ file_path: join(dir, 'src', 'a.ts') }),
      docsToo: true,
    },
  ])('AC-2 still counts $label', ({ input, docsToo }) =>
    withRepo(({ dir, hookPath, selfHookPath }) => {
      setPhase(dir, 'green')
      const transcript = writeRawTranscript(dir, [
        ...(docsToo ? editLines('edit-0', { file_path: join(dir, 'docs', 'a.md') }) : []),
        ...editLines('edit-1', input(dir)),
      ])
      expect(run(hookPath, dir, transcript).status).toBe(2)
      expect(run(selfHookPath, dir, transcript).status).toBe(2)
    }),
  )

  it('AC-4 keeps blocking when the recovery Skill(tdd) fails, and passes Skill → edit → edit', () =>
    withRepo(({ dir, hookPath }) => {
      setPhase(dir, 'red')
      const src = { file_path: join(dir, 'src', 'a.ts') }
      const failed = writeRawTranscript(dir, [
        ...editLines('edit-1', src),
        ...skillLines('skill-1', { is_error: true }),
      ])
      expect(run(hookPath, dir, failed).status).toBe(2)
      const happy = writeRawTranscript(dir, [
        ...skillLines('skill-1'),
        ...editLines('edit-1', src),
        ...editLines('edit-2', src),
      ])
      expect(run(hookPath, dir, happy).status).toBe(0)
    }))

  it.each(['green', 'refactor'])(
    'AC-1 accepts a committed valid RED receipt in %s whatever the transcript order',
    (phase) =>
      withRepo(({ dir, hookPath, selfHookPath }) => {
        recordRed(dir, { commit: true })
        setPhase(dir, phase)
        const transcript = writeRawTranscript(
          dir,
          editLines('edit-1', { file_path: join(dir, 'src', 'a.ts') }),
        )
        const rendered = run(hookPath, dir, transcript)
        expect([rendered.status, rendered.stderr]).toEqual([0, ''])
        expect(run(selfHookPath, dir, transcript).status).toBe(0)
      }),
  )

  it.each([
    { label: 'present on disk but untracked', commit: false },
    { label: 'committed without a failure signature', commit: true, log: 'all green\n' },
  ])('AC-1 rejects a receipt $label', ({ commit, log }) =>
    withRepo(({ dir, hookPath }) => {
      recordRed(dir, { commit, log })
      setPhase(dir, 'green')
      const transcript = writeRawTranscript(
        dir,
        editLines('edit-1', { file_path: join(dir, 'src', 'a.ts') }),
      )
      expect(run(hookPath, dir, transcript).status).toBe(2)
    }),
  )

  it('AC-3 a committed receipt does not unlock an edit in red without Skill(tdd)', () =>
    withRepo(({ dir, hookPath, selfHookPath }) => {
      recordRed(dir, { commit: true })
      setPhase(dir, 'red')
      const transcript = writeRawTranscript(
        dir,
        editLines('edit-1', { file_path: join(dir, 'src', 'a.ts') }),
      )
      expect(run(hookPath, dir, transcript).status).toBe(2)
      expect(run(selfHookPath, dir, transcript).status).toBe(2)
    }))

  it('AC-6 does not re-block an unchanged transcript once stop_hook_active is set', () =>
    withRepo(({ dir, hookPath }) => {
      setPhase(dir, 'green')
      const src = { file_path: join(dir, 'src', 'a.ts') }
      const transcript = writeRawTranscript(dir, editLines('edit-1', src))
      const active = (path: string) =>
        run(
          hookPath,
          dir,
          path,
          undefined,
          hookInput(dir, path, undefined, { stop_hook_active: true }),
        )

      expect(run(hookPath, dir, transcript).status).toBe(2)
      expect(active(transcript).status).toBe(0)

      const newEdit = writeRawTranscript(dir, [
        ...editLines('edit-1', src),
        ...editLines('edit-2', src),
      ])
      expect(active(newEdit).status).toBe(2)
      expect(active(newEdit).status).toBe(0)
    }))

  it('AC-1 verifies the receipt in-process, within budget, without the repository validator', () =>
    withRepo(({ dir, hookPath, selfHookPath }) => {
      recordRed(dir, { commit: true })
      setPhase(dir, 'green')
      // Stands in for arbiter's own validator, which takes ~8s and would time out the Stop hook.
      writeFileSync(
        join(dir, 'scripts', 'check-tdd-evidence.mjs'),
        'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000)\nprocess.exit(1)\n',
      )
      const transcript = writeRawTranscript(
        dir,
        editLines('edit-1', { file_path: join(dir, 'src', 'a.ts') }),
      )
      for (const path of [hookPath, selfHookPath]) {
        const started = performance.now()
        const result = run(path, dir, transcript)
        const elapsed = performance.now() - started
        expect([result.status, result.stderr]).toEqual([0, ''])
        expect(elapsed).toBeLessThan(500)
      }
    }))

  it.each([
    { label: 'for another task', patch: { task_id: '#9999' } },
    {
      label: 'whose RED commit is not an ancestor of HEAD',
      patch: { test_commit_sha: 'f'.repeat(40) },
    },
    { label: 'whose test path is absent at the RED commit', patch: { test_path: 'src/b.test.ts' } },
  ])('AC-1 rejects a committed receipt $label', ({ patch }) =>
    withRepo(({ dir, hookPath, selfHookPath }) => {
      recordRed(dir, { commit: true, patch })
      setPhase(dir, 'green')
      const transcript = writeRawTranscript(
        dir,
        editLines('edit-1', { file_path: join(dir, 'src', 'a.ts') }),
      )
      expect(run(hookPath, dir, transcript).status).toBe(2)
      expect(run(selfHookPath, dir, transcript).status).toBe(2)
    }),
  )

  it.each([
    {
      label: 'a docs/*.md symlink to a source file',
      link: (dir: string) => {
        touch(join(dir, 'src', 'a.ts'))
        mkdirSync(join(dir, 'docs'), { recursive: true })
        symlinkSync(join(dir, 'src', 'a.ts'), join(dir, 'docs', 'evil.md'))
        return join(dir, 'docs', 'evil.md')
      },
    },
    {
      label: 'a file under a docs/ directory symlinked to src/',
      link: (dir: string) => {
        touch(join(dir, 'src', 'a.ts'))
        symlinkSync(join(dir, 'src'), join(dir, 'docs'))
        return join(dir, 'docs', 'a.ts')
      },
    },
    { label: 'a docs/ path that does not exist', link: (dir: string) => join(dir, 'docs', 'x.md') },
  ])('AC-2 classifies by real path and still counts $label', ({ link }) =>
    withRepo(({ dir, hookPath, selfHookPath }) => {
      setPhase(dir, 'green')
      const transcript = writeRawTranscript(dir, editLines('edit-1', { file_path: link(dir) }))
      expect(run(hookPath, dir, transcript).status).toBe(2)
      expect(run(selfHookPath, dir, transcript).status).toBe(2)
    }),
  )

  it('AC-4 in red, a successful Skill(tdd) forgives only the edits after it', () =>
    withRepo(({ dir, hookPath, selfHookPath }) => {
      setPhase(dir, 'red')
      const src = { file_path: join(dir, 'src', 'a.ts') }
      const transcript = writeRawTranscript(dir, [
        ...editLines('edit-1', src),
        ...skillLines('skill-1'),
        ...editLines('edit-2', src),
      ])
      const blocked = run(hookPath, dir, transcript)
      expect(blocked.status).toBe(2)
      expect(blocked.stderr).toMatch(/receipt/)
      expect(run(selfHookPath, dir, transcript).status).toBe(2)
    }))

  it('AC-4 does not forgive an edit that completes while Skill(tdd) has no result yet', () =>
    withRepo(({ dir, hookPath, selfHookPath }) => {
      setPhase(dir, 'red')
      const [skillCall, skillResult] = skillLines('skill-1')
      const transcript = writeRawTranscript(dir, [
        skillCall,
        ...editLines('edit-1', { file_path: join(dir, 'src', 'a.ts') }),
        skillResult,
      ])
      expect(run(hookPath, dir, transcript).status).toBe(2)
      expect(run(selfHookPath, dir, transcript).status).toBe(2)
    }))

  it('AC-4 does not forgive an edit called while Skill(tdd) has no result yet', () =>
    withRepo(({ dir, hookPath, selfHookPath }) => {
      setPhase(dir, 'red')
      const [skillCall, skillResult] = skillLines('skill-1')
      const [editCall, editResult] = editLines('edit-1', { file_path: join(dir, 'src', 'a.ts') })
      const transcript = writeRawTranscript(dir, [skillCall, editCall, skillResult, editResult])
      expect(run(hookPath, dir, transcript).status).toBe(2)
      expect(run(selfHookPath, dir, transcript).status).toBe(2)
    }))

  it('AC-4 in green, a committed receipt covers an edit made before Skill(tdd)', () =>
    withRepo(({ dir, hookPath }) => {
      recordRed(dir, { commit: true })
      setPhase(dir, 'green')
      const src = { file_path: join(dir, 'src', 'a.ts') }
      const transcript = writeRawTranscript(dir, [
        ...editLines('edit-1', src),
        ...skillLines('skill-1'),
      ])
      expect(run(hookPath, dir, transcript).status).toBe(0)
    }))

  describe('AC-6 binds the stop_hook_active marker to task, phase, transcript and edit', () => {
    const src = (dir: string) => ({ file_path: join(dir, 'src', 'a.ts') })
    const activeInput = (dir: string, path: string, cwd = dir) =>
      JSON.stringify({ ...JSON.parse(hookInput(dir, path)), cwd, stop_hook_active: true })

    it.each([
      {
        label: 'the task changes',
        change: (dir: string) => patchStatus(dir, { taskId: '#2384' }),
      },
      { label: 'the phase changes', change: (dir: string) => setPhase(dir, 'refactor') },
    ])('re-blocks the same edit id when $label', ({ change }) =>
      withRepo(({ dir, hookPath }) => {
        setPhase(dir, 'green')
        const transcript = writeRawTranscript(dir, editLines('edit-1', src(dir)))
        expect(run(hookPath, dir, transcript).status).toBe(2)
        change(dir)
        const active = activeInput(dir, transcript)
        expect(run(hookPath, dir, transcript, undefined, active).status).toBe(2)
      }),
    )

    it('re-blocks the same edit id read from another transcript', () =>
      withRepo(({ dir, hookPath }) => {
        setPhase(dir, 'green')
        expect(
          run(hookPath, dir, writeRawTranscript(dir, editLines('edit-1', src(dir)))).status,
        ).toBe(2)
        const sub = join(dir, 'src')
        mkdirSync(sub, { recursive: true })
        const other = join(
          testHome(dir),
          '.claude',
          'projects',
          encodeProjectPath(resolve(sub)),
          `${SESSION_ID}.jsonl`,
        )
        mkdirSync(dirname(other), { recursive: true })
        writeFileSync(
          other,
          editLines('edit-1', src(dir))
            .map((line) => JSON.stringify(line))
            .join('\n') + '\n',
        )
        expect(run(hookPath, dir, other, undefined, activeInput(dir, other, sub)).status).toBe(2)
      }))
  })
})
