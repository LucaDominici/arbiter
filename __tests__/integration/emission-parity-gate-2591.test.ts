// SPDX-License-Identifier: Apache-2.0
// #2591: the emitted acceptance-anchor gate (INV-138) must be able to fail a consumer's
// build once they opt in (features.acceptanceAnchor: true) — previously it was wired
// `runWarnCheck` in the emitted `gate-registry.yml.ejs`/`check-all.mjs.ejs`, which
// (scripts/lib/run-helpers.mjs) never returns non-zero regardless of the underlying
// script's exit code. Proven by inversion, at the level the opt-in declares: the
// emitted `scripts/check-all.mjs` itself, in a hermetic `arbiter init` fixture, never
// arbiter's own dogfooded `check-all.mjs`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { runInit } from '../../src/commands/init.js'

const GATE_ID = 'acceptance anchor (INV-138)'
const GOOD_PLAN = [
  '## Acceptance Criteria',
  '- [ ] AC-1: observable behavior one',
  '## Non-Goals',
  '- out of scope',
].join('\n')
const BAD_PLAN = '## Some Other Heading\nnot an anchor\n'

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

function runGate(dir: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [join(dir, 'scripts', 'check-all.mjs'), '--gate', GATE_ID],
    { cwd: dir, encoding: 'utf-8' },
  )
  return { status: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') }
}

function optIn(dir: string): void {
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ features: { acceptanceAnchor: true } }))
}

function writeTaskState(dir: string, planBody: string): void {
  mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
  writeFileSync(
    join(dir, '.claude', '.task', 'status.json'),
    JSON.stringify({ taskId: '#2591', phase: 'red', plan: 'plan.md' }),
  )
  writeFileSync(join(dir, 'plan.md'), planBody)
}

describe('#2591 emitted acceptance-anchor gate can fail a consumer build', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-2591-'))
    initGit(dir)
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      noVerify: true,
      language: 'typescript',
    })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // AC-2: a fresh init'd tree, flag absent, is never day-1 red.
  it('AC-2: stays green with no opt-in', () => {
    const gate = runGate(dir)
    expect(gate.status).toBe(0)
  })

  // AC-3: inversion — with the flag on and the anchor missing, the emitted check-all
  // itself exits non-zero (not just the underlying script run directly).
  it('AC-3: FAILS the emitted check-all when opted in and the plan lacks its AC-N anchor', () => {
    optIn(dir)
    writeTaskState(dir, BAD_PLAN)
    const gate = runGate(dir)
    expect(gate.status).not.toBe(0)
  })

  // AC-3: same fixture, anchor present — exits 0.
  it('AC-3: PASSES the emitted check-all when opted in and the anchor is present', () => {
    optIn(dir)
    writeTaskState(dir, GOOD_PLAN)
    const gate = runGate(dir)
    expect(gate.status).toBe(0)
  })
})
