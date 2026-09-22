// SPDX-License-Identifier: Apache-2.0
// RED phase (acceptance-anchor, INV-138): the gate script must be inert without the
// feature flag, vacuous without an active task, hard-fail a plan missing the frozen
// AC anchor during implementation phases, fail-closed (exit 2) on malformed state,
// strip #fragment plan anchors (wave mode), and demand an all-PASS ac-fit artifact
// at verification/close.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  cpSync,
  chmodSync,
  symlinkSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { renderTemplate } from '../../src/utils/render.js'
import { computeAcHash, parsePlanAnchor } from '../../scripts/lib/acceptance-criteria.mjs'
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

function installGh(response: Record<string, unknown>): string {
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  const gh = join(bin, 'gh')
  writeFileSync(
    gh,
    `#!/bin/sh\nprintf '%s' '${JSON.stringify(response).replaceAll("'", "'\\\"'\\\"'")}'\n`,
  )
  chmodSync(gh, 0o755)
  return bin
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
    const result = run()
    expect(result.status, result.stderr + result.stdout).toBe(1)
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

  it('classifies a null late-phase ac-fit as evidence failure (1)', () => {
    writeState('verification')
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    writeFileSync(join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'), 'null')
    const result = run()
    expect(result.status, result.stderr + result.stdout).toBe(1)
  })

  it('rejects late-phase fit when live branch binding is absent', () => {
    writeState('verification')
    execFileSync('git', ['init', '-b', 'task/#42-fit'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'fixture.invalid'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root })
    execFileSync('git', ['add', 'plan.md'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: root, stdio: 'ignore' })
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    writeFileSync(
      join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'),
      JSON.stringify({
        schema: 'arbiter-ac-fit-v1',
        taskId: '#42',
        sha,
        criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'plan.md', line: 1 }] }],
      }),
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr + result.stdout).toMatch(/branch/i)
  })

  it('keeps frozen ac-fit valid across an evidence-only commit and rejects later source changes', () => {
    const branch = 'task/#42-fit'
    writeState('verification')
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', phase: 'verification', plan: 'plan.md', branch }),
    )
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'subject.ts'), 'export const subject = true\n')
    execFileSync('git', ['init', '-b', branch], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'fixture.invalid'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root })
    execFileSync('git', ['add', '.claude/.task/status.json', 'plan.md', 'src/subject.ts'], {
      cwd: root,
    })
    execFileSync('git', ['commit', '-m', 'source'], { cwd: root, stdio: 'ignore' })
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    const acceptanceFit = {
      schema: 'arbiter-ac-fit-v1',
      taskId: '#42',
      criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'src/subject.ts', line: 1 }] }],
    }
    const envelope = JSON.stringify({
      schema: 'arbiter-agent-return-v1',
      agent: 'fixture-verifier',
      role: 'verifier',
      taskId: '#42',
      branch,
      sha,
      verdict: 'PASS',
      confidence: 1,
      findings: [],
      acceptanceFit,
    })
    const envelopePath = '.arbiter/evidence/agent-returns/_42/verifier.json'
    mkdirSync(join(root, '.arbiter', 'evidence', 'agent-returns', '_42'), { recursive: true })
    mkdirSync(join(root, '.arbiter', 'evidence', 'ac-fit'), { recursive: true })
    writeFileSync(join(root, envelopePath), envelope)
    const plan = parsePlanAnchor(GOOD_PLAN)
    expect(plan).not.toBeNull()
    writeFileSync(
      join(root, '.arbiter', 'evidence', 'ac-fit', '42.json'),
      JSON.stringify({
        ...acceptanceFit,
        branch,
        sha,
        planHash: computeAcHash(plan!.criteria),
        sourceEnvelope: {
          path: envelopePath,
          sha256: createHash('sha256').update(envelope).digest('hex'),
        },
      }),
    )
    execFileSync('git', ['add', '.arbiter'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'evidence'], { cwd: root, stdio: 'ignore' })

    expect(run().status).toBe(0)

    writeFileSync(join(root, 'src', 'subject.ts'), 'export const subject = false\n')
    execFileSync('git', ['add', 'src/subject.ts'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'source changed'], { cwd: root, stdio: 'ignore' })
    const stale = run()
    expect(stale.status).toBe(1)
    expect(stale.stderr).toMatch(/source changed/i)
  })

  it('--plan mode validates a given plan file directly (wave integrate)', () => {
    writeFileSync(join(root, 'wave.md'), GOOD_PLAN)
    expect(run({}, ['--plan', 'wave.md']).status).toBe(0)
    writeFileSync(join(root, 'bad.md'), 'nothing')
    expect(run({}, ['--plan', 'bad.md']).status).toBe(1)
    expect(run({}, ['--plan', 'missing.md']).status).toBe(2)
  })

  it('--admit-issue returns NO DATA (2) when gh cannot read the issue', () => {
    writeFileSync(join(root, 'wave.md'), GOOD_PLAN)
    const r = run({}, ['--plan', 'wave.md', '--admit-issue', '42'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/NO DATA/i)
  })

  it('--admit-issue accepts positional source criteria with matching frozen text', () => {
    writeFileSync(
      join(root, 'wave.md'),
      [
        '## Acceptance Criteria',
        '- [ ] AC-42.1: preserves the requested outcome',
        '## Non-Goals',
        '- x',
      ].join('\n'),
    )
    const bin = installGh({
      number: 42,
      url: 'https://example.invalid/issues/42',
      body: '## Acceptance Criteria\n- preserves the requested outcome',
      updatedAt: '2026-09-20T00:00:00Z',
    })
    const result = run({ PATH: `${bin}:${process.env.PATH ?? ''}` }, [
      '--plan',
      'wave.md',
      '--admit-issue',
      '42',
    ])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OK check-acceptance (issue #42 admitted)')
  })

  it('--admit-issue rejects a source criterion missing from the plan', () => {
    writeFileSync(
      join(root, 'wave.md'),
      [
        '## Acceptance Criteria',
        '- [ ] AC-42.1: preserves the requested outcome',
        '## Non-Goals',
        '- x',
      ].join('\n'),
    )
    const bin = installGh({
      number: 42,
      url: 'https://example.invalid/issues/42',
      body: [
        '## Acceptance Criteria',
        '- AC-1: preserves the requested outcome',
        '- AC-2: reports the failure',
      ].join('\n'),
      updatedAt: '2026-09-20T00:00:00Z',
    })
    const result = run({ PATH: `${bin}:${process.env.PATH ?? ''}` }, [
      '--plan',
      'wave.md',
      '--admit-issue',
      '42',
    ])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('criterion AC-2 is missing as plan AC-42.2')
  })

  it('--admit-issue kills a timed-out gh process and returns explicit NO DATA (2)', () => {
    writeFileSync(join(root, 'wave.md'), GOOD_PLAN)
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    const gh = join(bin, 'gh')
    writeFileSync(gh, "#!/bin/sh\ntrap '' TERM\nwhile :; do :; done\n")
    chmodSync(gh, 0o755)
    const result = run({ PATH: `${bin}:${process.env.PATH ?? ''}` }, [
      '--plan',
      'wave.md',
      '--admit-issue',
      '42',
    ])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('NO DATA: unable to read issue #42 for plan admission')
  })

  it('--plan --ac-fit combined mode enforces all-PASS wave fit — red-team F5', () => {
    writeFileSync(
      join(root, 'wave.md'),
      ['## Acceptance Criteria', '- [ ] AC-123.1: behavior', '## Non-Goals', '- x'].join('\n'),
    )
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'x.ts'), 'one\ntwo\nthree\n')
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
      // gate-derivation.mjs (#2773) resolves 'minimatch' via gate-affects-registry.mjs;
      // symlink node_modules so the emitted fixture's dynamic import can resolve it.
      symlinkSync(resolve(__dirname, '../../node_modules'), join(root, 'node_modules'), 'dir')
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
  if (projection === 'emitted') {
    it('rejects missing gate derivation support before red', () => {
      rmSync(join(root, 'scripts', 'lib', 'gate-derivation.mjs'))
      const plan = ['---', 'files:', '  - src/example.ts', '---', GOOD_PLAN].join('\n')
      writeState('plan', 'plan.md', plan)
      const result = invoke(['--plan', 'plan.md'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('derived gate contract support is missing')
    })
  }
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
        criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'plan.md', line: 1 }] }],
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
