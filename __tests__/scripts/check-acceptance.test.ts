// SPDX-License-Identifier: Apache-2.0
// RED phase (acceptance-anchor, INV-138): the gate script must be inert without the
// feature flag, vacuous without an active task, hard-fail a plan missing the frozen
// AC anchor during implementation phases, fail-closed (exit 2) on malformed state,
// strip #fragment plan anchors (wave mode), and demand an all-PASS ac-fit artifact
// at verification/close.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  cpSync,
  symlinkSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const SCRIPT = resolve(__dirname, '../../scripts/check-acceptance.mjs')

const GOOD_PLAN = [
  '## Acceptance Criteria',
  '- [ ] AC-1: observable behavior one',
  '## Non-Goals',
  '- out of scope',
].join('\n')

let root: string

function run(env: Record<string, string> = {}, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: '1', ...env },
  })
}

function writeState(phase: string, plan = 'plan.md', planBody = GOOD_PLAN) {
  mkdirSync(join(root, '.claude', '.task'), { recursive: true })
  writeFileSync(
    join(root, '.claude', '.task', 'status.json'),
    JSON.stringify({ taskId: '#42', phase, plan }),
  )
  if (planBody !== null) writeFileSync(join(root, plan), planBody)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-acceptance-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-acceptance gate', () => {
  it('exits 0 (inert) when the flag is off', () => {
    writeState('red', 'plan.md', 'no anchor at all')
    const r = run({ ARBITER_ACCEPTANCE_ANCHOR: '0' })
    expect(r.status).toBe(0)
  })

  it('exits 0 (vacuous) with no active task state', () => {
    expect(run().status).toBe(0)
  })

  it('exits 0 in pre-implementation phases regardless of plan content', () => {
    writeState('plan', 'plan.md', 'no anchor')
    expect(run().status).toBe(0)
  })

  it('fails (1) an implementation-phase task whose plan lacks the AC anchor', () => {
    writeState('red', 'plan.md', '# Plan\nno sections')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/Acceptance Criteria/i)
  })

  it('fails (1) when the anchor has criteria without explicit AC-N ids', () => {
    writeState('red', 'plan.md', '## Acceptance Criteria\n- [ ] bare\n## Non-Goals\n- x')
    expect(run().status).toBe(1)
  })

  it('passes (0) an implementation-phase task with a frozen anchor', () => {
    writeState('green')
    expect(run().status).toBe(0)
  })

  it('treats legacy phase "implementation" as red', () => {
    writeState('implementation', 'plan.md', 'no anchor')
    expect(run().status).toBe(1)
  })

  it('exits 2 (fail-closed, with reset instructions) on an unknown phase', () => {
    writeState('what-even-is-this')
    const r = run()
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/ARBITER_ACCEPTANCE_ANCHOR=0/)
  })

  it('exits 2 when the anchored plan file is missing', () => {
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', phase: 'red', plan: 'gone.md' }),
    )
    expect(run().status).toBe(2)
  })

  it('exits 2 on malformed status.json', () => {
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(join(root, '.claude', '.task', 'status.json'), '{not json')
    expect(run().status).toBe(2)
  })

  it('strips a #fragment from the anchored plan path (wave mode)', () => {
    writeState('red', 'wave-1.md')
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', phase: 'red', plan: 'wave-1.md#group-a' }),
    )
    expect(run().status).toBe(0)
  })

  it('validates an ac-fit artifact when present (invalid ⇒ 1)', () => {
    writeState('refactor')
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'),
      JSON.stringify({ schema: 'wrong', criteria: [] }),
    )
    expect(run().status).toBe(1)
  })

  it('requires an all-PASS ac-fit artifact at verification (missing ⇒ 1)', () => {
    writeState('verification')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/ac-fit/i)
  })

  it('passes verification with a complete all-PASS ac-fit artifact', () => {
    writeState('verification')
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: '#42',
        sha: 'abc',
        criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'src/x.ts', line: 1 }] }],
      }),
    )
    expect(run().status).toBe(0)
  })

  it('--plan mode validates a given plan file directly (wave integrate)', () => {
    writeFileSync(join(root, 'wave.md'), GOOD_PLAN)
    expect(run({}, ['--plan', 'wave.md']).status).toBe(0)
    writeFileSync(join(root, 'bad.md'), 'nothing')
    expect(run({}, ['--plan', 'bad.md']).status).toBe(1)
    expect(run({}, ['--plan', 'missing.md']).status).toBe(2)
  })

  it('--plan --ac-fit combined mode enforces all-PASS wave fit — red-team F5', () => {
    writeFileSync(
      join(root, 'wave.md'),
      ['## Acceptance Criteria', '- [ ] AC-123.1: behavior', '## Non-Goals', '- x'].join('\n'),
    )
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    const fit = join('.arbiter', 'evidence', 'ac-fit', 'wave-1.json')
    writeFileSync(
      join(root, fit),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: 'wave-1',
        criteria: [{ id: 'AC-123.1', verdict: 'NOT-TESTED', evidence: [] }],
      }),
    )
    expect(run({}, ['--plan', 'wave.md', '--ac-fit', fit]).status).toBe(1)
    writeFileSync(
      join(root, fit),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: 'wave-1',
        criteria: [{ id: 'AC-123.1', verdict: 'PASS', evidence: [{ file: 'src/x.ts', line: 3 }] }],
      }),
    )
    expect(run({}, ['--plan', 'wave.md', '--ac-fit', fit]).status).toBe(0)
  })

  it('rejects duplicate anchor ids (wave plans must namespace) — red-team F3', () => {
    writeState(
      'red',
      'plan.md',
      [
        '## Acceptance Criteria',
        '- [ ] AC-1: from issue A',
        '- [ ] AC-1: from issue B',
        '## Non-Goals',
        '- x',
      ].join('\n'),
    )
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/duplicate/i)
  })

  it('treats an empty/absent phase as preflight (SKIP) — red-team F10', () => {
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', plan: 'plan.md' }),
    )
    expect(run().status).toBe(0)
  })

  it('wave workers (fragment-anchored) are not required to carry a per-task ac-fit at verification — red-team F7', () => {
    writeState('verification', 'wave-1.md')
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', phase: 'verification', plan: 'wave-1.md#group-a' }),
    )
    expect(run().status).toBe(0)
  })

  it('rejects an ac-fit artifact whose taskId does not match the active task — red-team F12', () => {
    writeState('refactor')
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: '#99',
        criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'src/x.ts', line: 1 }] }],
      }),
    )
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/does not match/)
  })
})

describe.each(['self', 'emitted'])('#2635 acceptance input boundaries (%s)', (projection) => {
  let script: string
  beforeEach(() => {
    script = SCRIPT
    if (projection === 'emitted') {
      cpSync(resolve('scripts/lib'), join(root, 'scripts/lib'), { recursive: true })
      for (const rel of ['check-acceptance.mjs', 'lib/run-helpers.mjs']) {
        writeFileSync(
          join(root, 'scripts', rel),
          renderTemplate(`scripts/${rel}.ejs`, makeConfig(root)),
        )
      }
      script = join(root, 'scripts/check-acceptance.mjs')
    }
  })
  const invoke = (args: string[] = [], override = '1') =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 1000,
      killSignal: 'SIGKILL',
      env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: override },
    })
  it.each([null, [], 0, 'state', true].map((value) => [value]))(
    'rejects nonrecord state %j as ERROR2',
    (value) => {
      writeState('red')
      writeFileSync(join(root, '.claude/.task/status.json'), JSON.stringify(value))
      const result = invoke()
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(2)
    },
  )
  it.each([{}, { taskId: '#42' }, { phase: '' }])('preserves fresh record %j as SKIP', (value) => {
    writeState('red')
    writeFileSync(join(root, '.claude/.task/status.json'), JSON.stringify(value))
    const result = invoke()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('SKIP')
  })
  it.each([
    ['.claude/.task/status.json', 2],
    ['plan.md', 2],
    ['fit.json', 1],
    ['arbiter.json', 0],
  ] as const)('never waits for a FIFO writer at %s', (rel, code) => {
    writeState('red')
    writeFileSync(
      join(root, 'arbiter.json'),
      JSON.stringify({ features: { acceptanceAnchor: true } }),
    )
    writeFileSync(
      join(root, 'fit.json'),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: '#42',
        criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'src/x.ts', line: 1 }] }],
      }),
    )
    const args = rel === 'fit.json' ? ['--plan', 'plan.md', '--ac-fit', 'fit.json'] : []
    const override = rel === 'arbiter.json' ? '' : '1'
    expect(invoke(args, override).status).toBe(0)
    const path = join(root, rel),
      original = readFileSync(path)
    rmSync(path)
    expect(spawnSync('mkfifo', [path]).status).toBe(0)
    const result = invoke(args, override)
    expect(result.error, result.stderr).toBeUndefined()
    expect(result.status, result.stderr).toBe(code)
    rmSync(path)
    writeFileSync(path, original)
    expect(invoke(args, override).status).toBe(0)
  })
  it('preserves regular state/absolute plan symlinks but rejects dangling state', () => {
    writeState('red')
    const state = join(root, '.claude/.task/status.json')
    writeFileSync(join(root, 'state.json'), readFileSync(state))
    rmSync(state)
    symlinkSync(join(root, 'state.json'), state)
    symlinkSync(join(root, 'plan.md'), join(root, 'plan-link.md'))
    expect(invoke(['--plan', join(root, 'plan-link.md')]).status).toBe(0)
    expect(invoke().status).toBe(0)
    rmSync(join(root, 'state.json'))
    expect(invoke().status).toBe(2)
  })
  it('rejects a regular state replaced with a FIFO after presence inspection', () => {
    writeState('red')
    const state = join(root, '.claude/.task/status.json')
    const preload = join(root, 'replace-state.mjs')
    writeFileSync(
      preload,
      `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; import {execFileSync} from 'node:child_process';
      const original=fs.lstatSync; fs.lstatSync=function(path,...args){const stat=original(path,...args); if(path===${JSON.stringify(state)}){fs.unlinkSync(path);execFileSync('mkfifo',[path]);}return stat;};syncBuiltinESMExports();`,
    )
    const result = spawnSync(process.execPath, ['--import', preload, script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 1000,
      killSignal: 'SIGKILL',
      env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: '1' },
    })
    expect(result.error, result.stderr).toBeUndefined()
    expect(result.status, result.stderr).toBe(2)
  })
})
