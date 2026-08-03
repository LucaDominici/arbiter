// SPDX-License-Identifier: Apache-2.0
// #2110: the governed project's OWN gate detects that a file arbiter emitted is
// gone, without arbiter installed — it reads the committed
// `.arbiter-generated-manifest.json`. Exercises the script AS EMITTED into the
// target (never arbiter's source template), which is what a consumer's gate runs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { runInit } from '../../src/commands/init.js'

const GATE = ['scripts', 'check-emission-parity.mjs'] as const

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
  const r = spawnSync('node', [join(dir, ...GATE)], { cwd: dir, encoding: 'utf-8' })
  return { status: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') }
}

describe('#2110 emission-parity gate (no arbiter dependency)', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-2110-'))
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

  it('is emitted by init and starts green on a freshly generated project', () => {
    expect(existsSync(join(dir, ...GATE))).toBe(true)
    const gate = runGate(dir)
    expect(gate.status).toBe(0)
    expect(gate.stdout).toContain('[emission-parity] PASS')
  })

  it('FAILS when a file arbiter emitted has been deleted', () => {
    unlinkSync(join(dir, '.claude', 'hooks', 'stop-dangerous.mjs'))
    const gate = runGate(dir)
    expect(gate.status).toBe(1)
    expect(gate.stderr).toContain('MISSING emitted file .claude/hooks/stop-dangerous.mjs')
  })

  it('PASSES on a locally diverged file — customization is not drift to fail on', () => {
    writeFileSync(join(dir, ...GATE.slice(0, 1), 'check-all.mjs'), '// customized gate\n', {
      flag: 'a',
    })
    const gate = runGate(dir)
    expect(gate.status).toBe(0)
    expect(gate.stderr).toContain('diverged')
  })

  it('FAILS closed when the repo carries no provenance record at all', () => {
    unlinkSync(join(dir, '.arbiter-generated-manifest.json'))
    const gate = runGate(dir)
    expect(gate.status).toBe(1)
    expect(gate.stderr).toContain('no .arbiter-generated-manifest.json')
  })

  it('ERRORS (exit 2) on a malformed manifest rather than passing vacuously', () => {
    writeFileSync(join(dir, '.arbiter-generated-manifest.json'), '{"$schemaVersion":1}')
    const gate = runGate(dir)
    expect(gate.status).toBe(2)
    expect(gate.stderr).toContain('invalid shape')
  })
})
