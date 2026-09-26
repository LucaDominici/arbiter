// SPDX-License-Identifier: Apache-2.0
// RED (#2911): three coded refusals must name the ONE failed sub-check and a remedy,
// instead of the current generic four-way / no-remedy text.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const RECORDER = new URL('../../scripts/record-agent-return.mjs', import.meta.url).pathname
const CHECK = new URL('../../scripts/check-acceptance.mjs', import.meta.url).pathname

let root: string

function git(...args: string[]) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arbiter-2911-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('#2911 AC-1: record-agent-return names the one failed check', () => {
  it('names the native host binding field instead of the generic four-way message', () => {
    git('init', '-b', 'task/#42-fit')
    git('config', 'user.email', 'fixture.invalid')
    git('config', 'user.name', 'Fixture')
    const plan = [
      '## Acceptance Criteria',
      '- [ ] AC-1: records the exact verifier result',
      '## Non-Goals',
      '- no alternate evidence store',
    ].join('\n')
    writeFileSync(join(root, 'plan.md'), plan)
    execFileSync('git', ['add', 'plan.md'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: root, stdio: 'ignore' })

    // task/branch/sha all match — only the native host binding is broken (missing bindingId).
    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({
        taskId: '#42',
        phase: 'verification',
        plan: 'plan.md',
        branch: 'task/#42-fit',
        hostBinding: { worktreePath: root },
      }),
    )

    const result = spawnSync(
      process.execPath,
      [RECORDER, '--mode', 'ac-fit', '--task', '#42', '--repo-root', root],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_CODE_SESSION_ID: undefined },
        input: JSON.stringify({
          schema: 'arbiter-agent-return-v1',
          agent: 'acceptance-verifier',
          role: 'verifier',
          taskId: '#42',
          branch: 'task/#42-fit',
          sha: head(),
          ts: '2026-09-15T00:00:00.000Z',
          verdict: 'PASS',
          confidence: 1,
          findings: [],
          acceptanceFit: {
            schema: 'arbiter-ac-fit-v1',
            taskId: '#42',
            criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'plan.md', line: 2 }] }],
          },
        }),
      },
    )

    const out = result.stdout + result.stderr
    // Must name the specific failed binding field (here: missing binding id), not the
    // generic "task, branch, sha, or native host binding is stale".
    expect(out).toMatch(/binding id is missing/i)
    // Must give the remedy for a binding-caused refusal.
    expect(out).toMatch(/lifecycle preflight/i)
  })
})

describe('#2911 AC-2: check-acceptance names NOT-TESTED criteria and both remedies', () => {
  it('lists the NOT-TESTED criterion ids and gives the exact-main and verifier-envelope remedies', () => {
    git('init', '-b', 'task/#42-fit')
    git('config', 'user.email', 'fixture.invalid')
    git('config', 'user.name', 'Fixture')
    const plan = [
      '## Acceptance Criteria',
      '- [ ] AC-1: records the exact verifier result',
      '## Non-Goals',
      '- no alternate evidence store',
    ].join('\n')
    writeFileSync(join(root, 'plan.md'), plan)
    execFileSync('git', ['add', 'plan.md'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: root, stdio: 'ignore' })

    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({
        taskId: '#42',
        phase: 'verification',
        plan: 'plan.md',
        branch: 'task/#42-fit',
      }),
    )

    // Reviewer returns NOT-TESTED on AC-1 (not marked [exact-main]) — record-agent-return
    // deliberately writes only the review return, not an ac-fit artifact.
    const recorded = spawnSync(
      process.execPath,
      [RECORDER, '--mode', 'ac-fit', '--task', '#42', '--repo-root', root],
      {
        cwd: root,
        encoding: 'utf8',
        input: JSON.stringify({
          schema: 'arbiter-agent-return-v1',
          agent: 'acceptance-verifier',
          role: 'verifier',
          taskId: '#42',
          branch: 'task/#42-fit',
          sha: head(),
          ts: '2026-09-15T00:00:00.000Z',
          verdict: 'PASS',
          confidence: 1,
          findings: [],
          acceptanceFit: {
            schema: 'arbiter-ac-fit-v1',
            taskId: '#42',
            criteria: [{ id: 'AC-1', verdict: 'NOT-TESTED', evidence: [] }],
          },
        }),
      },
    )
    expect(recorded.status, recorded.stderr + recorded.stdout).toBe(0)
    expect(recorded.stdout).toMatch(/no ac-fit written/i)

    // check-acceptance is asked for an ac-fit path that was never written.
    const check = spawnSync(
      process.execPath,
      [CHECK, '--plan', 'plan.md', '--ac-fit', '.arbiter/evidence/ac-fit/42.json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: '1' } },
    )

    const out = check.stdout + check.stderr
    expect(check.status).toBe(2)
    // Must list the NOT-TESTED criterion id ...
    expect(out).toMatch(/AC-1/)
    // ... and give both remedies.
    expect(out).toMatch(/exact-main/i)
    expect(out).toMatch(/independent verifier/i)
  })
})

describe('#2911 AC-3: check-acceptance names which derived input changed', () => {
  it('names the verification authority as the stale input after check-all.mjs changes', () => {
    mkdirSync(join(root, 'scripts'), { recursive: true })
    const authority = join(root, 'scripts', 'check-all.mjs')
    writeFileSync(
      authority,
      [
        '#!/usr/bin/env node',
        '// @arbiter-gate-contract arbiter-gate-contract-v1',
        "import { createHash } from 'node:crypto'",
        "import { readFileSync } from 'node:fs'",
        "import { fileURLToPath } from 'node:url'",
        'const path = fileURLToPath(import.meta.url)',
        "const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')",
        "console.log(JSON.stringify({ schema: 'arbiter-gate-contract-v1', authority: [{ path: 'scripts/check-all.mjs', sha256 }], gates: [], external: [], unresolved: [] }))",
        '',
      ].join('\n'),
    )
    const files = ['src/templates/claude/commands/ship.md.ejs']
    const plan = [
      '---',
      'files:',
      ...files.map((f) => `  - ${f}`),
      '---',
      '## Acceptance Criteria',
      '- [ ] AC-1: behavior',
      '## Non-Goals',
      '- x',
    ].join('\n')
    writeFileSync(join(root, 'plan.md'), plan)
    writeFileSync(
      join(root, 'arbiter.json'),
      JSON.stringify({
        collaborationMode: 'trunk-solo',
        solo: { mergeMode: 'pr-ff' },
        features: { acceptanceAnchor: true },
      }),
    )

    mkdirSync(join(root, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(root, '.claude', '.task', 'status.json'),
      JSON.stringify({ taskId: '#42', phase: 'plan', plan: 'plan.md', derivedGates: [] }),
    )

    // First establish a correctly-derived gate set (not asserted — just to prove the
    // subsequent failure is caused by the authority edit, not a missing derivation).
    const before = spawnSync(process.execPath, [CHECK, '--plan', 'plan.md'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: '1' },
    })
    expect(before.status).toBe(1) // derivedGates: [] does not match a fresh derivation yet

    // Now the verification authority itself changes.
    writeFileSync(authority, `${readFileSync(authority, 'utf8')}\n// changed authority\n`)

    const after = spawnSync(process.execPath, [CHECK, '--plan', 'plan.md'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ARBITER_ACCEPTANCE_ANCHOR: '1' },
    })
    const out = after.stdout + after.stderr
    expect(after.status).toBe(1)
    // Must name the verification authority (scripts/check-all.mjs) as the changed input,
    // not the generic "derived gates are missing or stale".
    expect(out).toMatch(/check-all\.mjs/i)
    expect(out).toMatch(/verification authority/i)
  })
})
