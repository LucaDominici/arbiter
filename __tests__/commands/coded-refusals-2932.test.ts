// SPDX-License-Identifier: Apache-2.0
/**
 * arbiter#2932 — four delivery-path refusals in src/commands/task.ts name their own remedy but
 * are plain `Error`s, so src/cli.ts prints them as `Unexpected error:`. Each must be the coded
 * E_GATE_REFUSED (AC-1); a checker that cannot run cleanly (exit other than 0/1, timeout,
 * missing script) stays an uncoded fault (AC-2). AC-3: every case runs the built CLI.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runTaskInit } from '../../src/commands/task.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const REPO = resolve(import.meta.dirname, '../..')
const CODED = /^Error \[E_GATE_REFUSED\]:/
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRepo(
  prefix: string,
  branch: string,
): { dir: string; git: (...a: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', branch)
  git('config', 'user.email', 'fixture@arbiter.dev')
  git('config', 'user.name', 'Fixture')
  writeFileSync(
    join(dir, '.gitignore'),
    '.claude/.task/\n.arbiter/\norigin.git/\nnode_modules\nbin/\n',
  )
  return { dir, git }
}

function cli(dir: string, args: string[]) {
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}` }
  delete env.CLAUDE_CODE_SESSION_ID
  delete env.CLAUDE_PROJECT_DIR
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8', env })
}

function expectCoded(result: ReturnType<typeof cli>, remedy: RegExp): void {
  expect(result.stderr).not.toContain('Unexpected error')
  expect(result.stderr.trimStart()).toMatch(CODED)
  expect(result.stderr).toMatch(remedy)
  expect(result.status).toBe(1)
}

function installAcceptanceChecker(dir: string): void {
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'dir')
  cpSync(join(REPO, 'scripts', 'lib'), join(dir, 'scripts', 'lib'), { recursive: true })
  for (const f of ['check-acceptance.mjs', 'derive-plan-gates.mjs'])
    cpSync(join(REPO, 'scripts', f), join(dir, 'scripts', f))
  writeFileSync(
    join(dir, 'scripts', 'check-all.mjs'),
    [
      '// @arbiter-gate-contract arbiter-gate-contract-v1',
      "import { createHash } from 'node:crypto'",
      "import { readFileSync } from 'node:fs'",
      "import { fileURLToPath } from 'node:url'",
      "const sha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')",
      "console.log(JSON.stringify({ schema: 'arbiter-gate-contract-v1', authority: [{ path: 'scripts/check-all.mjs', sha256 }], gates: [], external: [], unresolved: [] }))",
      '',
    ].join('\n'),
  )
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(
    join(dir, 'bin', 'gh'),
    '#!/bin/sh\nprintf \'%s\' \'{"number":2932,"url":"https://example.invalid/issues/2932","body":"## Acceptance Criteria\\n- AC-1: behavior","updatedAt":"2026-09-26T00:00:00Z"}\'\n',
  )
  chmodSync(join(dir, 'bin', 'gh'), 0o755)
  writeFileSync(
    join(dir, 'arbiter.json'),
    '{"collaborationMode":"trunk-solo","solo":{"mergeMode":"pr-ff"},"features":{"acceptanceAnchor":true}}\n',
  )
}

const PLAN = [
  '---',
  'files:',
  '  - plan.md',
  '---',
  '## Acceptance Criteria',
  '- [ ] AC-2932.1: behavior',
  '## Non-Goals',
  '- x',
].join('\n')

/** Anchored acceptance repo in `refactor`; `lifecycle resume` re-checks the derived gates. */
function anchoredRepo(): string {
  const { dir } = tempRepo('arbiter-2932-derived-', 'task/#2932')
  mkdirSync(join(dir, '.claude'), { recursive: true })
  installAcceptanceChecker(dir)
  writeFileSync(join(dir, 'plan.md'), PLAN)
  runTaskInit({ dir, id: '#2932', plan: 'plan.md' })
  writeUnifiedState(dir, { phase: 'refactor' })
  return dir
}

describe('AC-1 delivery refusals are coded, never Unexpected error (#2932)', () => {
  it('#2903 derived-stale: the required checker FAIL (exit 1) is E_GATE_REFUSED with its remedy', () => {
    const dir = anchoredRepo()
    const authority = join(dir, 'scripts', 'check-all.mjs')
    writeFileSync(authority, `${readFileSync(authority, 'utf-8')}// changed authority\n`)
    const result = cli(dir, ['lifecycle', 'resume', '--dir', dir])
    expectCoded(result, /derived gates are missing or stale/)
    expect(result.stderr).toContain('lifecycle start --plan')
  })

  it('base currency: a review round on a stale base is E_GATE_REFUSED naming the merge', () => {
    const { dir, git } = tempRepo('arbiter-2932-base-', 'main')
    const bare = join(dir, 'origin.git')
    execFileSync('git', ['init', '-q', '--bare', bare])
    writeFileSync(join(dir, 'plan.md'), PLAN)
    git('add', '-A')
    git('commit', '-q', '-m', 'seed')
    git('remote', 'add', 'origin', bare)
    git('push', '-q', 'origin', 'main')
    git('checkout', '-q', '-b', 'task/#2932-stale')
    writeFileSync(join(dir, 'landed.txt'), 'x\n')
    git('add', 'landed.txt')
    git('commit', '-q', '-m', 'landed on main')
    git('push', '-q', 'origin', 'HEAD:main')
    git('reset', '-q', '--hard', 'HEAD~1')
    git('update-ref', '-d', 'refs/remotes/origin/main')
    writeUnifiedState(dir, {
      phase: 'refactor',
      plan: 'plan.md',
      branch: 'task/#2932-stale',
      taskId: '#2932',
    })
    const result = cli(dir, ['ship', '--review-round', '--dir', dir])
    expectCoded(result, /git merge --no-edit origin\/main/)
  })

  it('acceptance-anchor: a malformed plan refused on red entry is E_GATE_REFUSED', () => {
    const { dir, git } = tempRepo('arbiter-2932-anchor-', 'task/#2932')
    installAcceptanceChecker(dir)
    writeFileSync(join(dir, 'plan.md'), '# Plan\nmissing acceptance anchor\n')
    git('add', '-f', 'plan.md')
    git('commit', '-q', '-m', 'test: track plan')
    writeUnifiedState(dir, { taskId: '#2932', phase: 'red-team-review', plan: 'plan.md' })
    mkdirSync(join(dir, '.arbiter', 'evidence', 'redteam'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'evidence', 'redteam', '#2932.json'), '{"findings":[]}\n')
    const result = cli(dir, ['lifecycle', 'advance', '--to', 'red', '--dir', dir])
    expectCoded(result, /acceptance-anchor gate: .*FAIL/s)
  })

  it('bake freeze: a template commit newer than the snapshots is E_GATE_REFUSED naming the rebake', () => {
    const { dir, git } = tempRepo('arbiter-2932-bake-', 'task/#2932-bake')
    writeFileSync(join(dir, 'plan.md'), PLAN)
    git('add', '-A')
    git('commit', '-q', '-m', 'seed')
    mkdirSync(join(dir, 'src', 'templates'), { recursive: true })
    writeFileSync(join(dir, 'src', 'templates', 'AGENTS.md.ejs'), 'x\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'fix: template before any rebake')
    writeUnifiedState(dir, {
      phase: 'refactor',
      plan: 'plan.md',
      taskId: '#2932',
      branch: 'task/#2932-bake',
      derivedGates: [
        {
          name: 'bake',
          kind: 'artifact-regenerate',
          command: 'BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake',
        },
      ],
    })
    const result = cli(dir, ['ship', '--review-round', '--dir', dir])
    expectCoded(result, /BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake/)
  })

  it('a checker that prints its FAIL on stdout (check-review-completion shape) carries that text', () => {
    const dir = anchoredRepo()
    writeFileSync(
      join(dir, 'scripts', 'check-acceptance.mjs'),
      'process.stdout.write("[check-x] FAIL: token-2932, run the remedy\\n"); process.exit(1)\n',
    )
    const result = cli(dir, ['lifecycle', 'resume', '--dir', dir])
    expectCoded(result, /\[check-x\] FAIL: token-2932, run the remedy/)
  })
})

describe('AC-2 a checker that cannot run cleanly stays a fault (#2932)', () => {
  it.each([
    [
      'exit 2 (checker ERROR)',
      'process.stderr.write("FAIL check-acceptance: io\\n"); process.exit(2)',
    ],
    ['exit 1 without a FAIL line (crash)', 'throw new Error("boom")'],
  ])('%s is not coded', (_label, body) => {
    const dir = anchoredRepo()
    writeFileSync(join(dir, 'scripts', 'check-acceptance.mjs'), `${body}\n`)
    const result = cli(dir, ['lifecycle', 'resume', '--dir', dir])
    expect(result.stderr).toContain('Unexpected error:')
    expect(result.stderr).not.toContain('E_GATE_REFUSED')
    expect(result.status).toBe(1)
  })
})
