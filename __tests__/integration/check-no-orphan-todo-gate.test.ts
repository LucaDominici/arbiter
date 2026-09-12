// SPDX-License-Identifier: Apache-2.0
// #2663 (INV-21): the governed project's OWN tree-scanning orphan-TODO gate,
// exercised AS EMITTED into the target — no arbiter install, no workflow-level
// hand grep. Same shape as emission-parity-gate.test.ts (#2110).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { runInit } from '../../src/commands/init.js'

const GATE = ['scripts', 'check-no-orphan-todo.mjs'] as const

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

describe('#2663 check-no-orphan-todo.mjs gate (no arbiter dependency)', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-2663-'))
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

  it('is emitted by init and wired at L1', () => {
    expect(existsSync(join(dir, ...GATE))).toBe(true)
  })

  it('FAILS (exit 1) and names the offending file on an orphan TODO', () => {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'orphan.ts'), '// TODO: fix this later\nexport const x = 1\n')
    const gate = runGate(dir)
    expect(gate.status).toBe(1)
    expect(gate.stdout).toContain('src/orphan.ts')
  })

  it('PASSES (exit 0) when the TODO cites an issue', () => {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'ok.ts'), '// TODO(#12): fix this later\nexport const x = 1\n')
    const gate = runGate(dir)
    expect(gate.status).toBe(0)
  })
})
