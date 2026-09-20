// SPDX-License-Identifier: Apache-2.0
// #2557: the kernel plugin's verifier-backed hooks imported `../../scripts/lib/*.mjs` —
// correct from a governed repo's `.claude/hooks/`, but from `<plugin>/hooks/` it points
// OUTSIDE the plugin. In a plugin-only install every such hook failed closed forever
// (every `gh pr create` blocked, every completion claim "verifier unavailable").
//
// These tests run each committed kernel hook from a temp directory holding ONLY what the
// plugin ships (packages/kernel/.claude-plugin + packages/kernel/hooks), against a temp
// git repo placed elsewhere, and assert the verifier actually loads. The fail-closed
// behaviour when a verifier is genuinely absent is asserted on the same layout.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const kernelDir = resolve(__dirname, '..', '..', 'packages', 'kernel')

let base: string
let pluginHooks: string
let repo: string

function git(...args: string[]): string {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

function writeJson(rel: string, value: unknown): void {
  const full = join(repo, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, JSON.stringify(value))
}

function runHook(
  name: string,
  stdin: unknown,
  env: Record<string, string> = {},
): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [join(pluginHooks, name)], {
    cwd: repo,
    input: JSON.stringify(stdin),
    encoding: 'utf-8',
    env: { ...process.env, ARBITER_SKIP_GATE_MARKER: '', ...env },
  })
  return { status: r.status, stderr: r.stderr }
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'kernel-plugin-only-'))
  const plugin = join(base, 'plugin')
  cpSync(join(kernelDir, '.claude-plugin'), join(plugin, '.claude-plugin'), { recursive: true })
  cpSync(join(kernelDir, 'hooks'), join(plugin, 'hooks'), { recursive: true })
  pluginHooks = join(plugin, 'hooks')

  repo = join(base, 'repo')
  mkdirSync(repo)
  git('init', '-q', '-b', 'task/demo')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  git('commit', '-q', '--allow-empty', '-m', 'init')
  writeJson('.claude/.task/status.json', { taskId: '#1', phase: 'verification' })
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const LOAD_FAILURE = /could not be loaded|verifier unavailable/

/** Plan-review evidence valid for HEAD, so stop-evidence-guard reaches the binding verifier. */
function writePassingPlanReview(): void {
  writeJson('.arbiter/evidence/plan-review/_1/latest.json', {
    verdict: 'PASS',
    branch: 'task/demo',
    sha: git('rev-parse', 'HEAD'),
  })
}

describe('kernel plugin hooks in a plugin-only install (#2557)', () => {
  it('enforce-gate-before-pr.mjs loads the gate-pass verifier', () => {
    writeJson('.arbiter/gate-pass.json', {})
    const r = runHook('enforce-gate-before-pr.mjs', { tool_input: { command: 'gh pr create' } })
    expect(r.stderr).not.toMatch(LOAD_FAILURE)
    expect(r.status).toBe(2) // the empty marker still fails verification — fail-closed
  })

  it('guard-done-evidence.mjs loads the done-receipt verifier', () => {
    const r = runHook(
      'guard-done-evidence.mjs',
      { hook_event_name: 'Stop', last_assistant_message: 'task complete' },
      { ARBITER_EVIDENCE_HARNESS: '1' },
    )
    expect(r.stderr).not.toMatch(LOAD_FAILURE)
    expect(r.status).toBe(2)
  })

  it('stop-evidence-guard.mjs loads the gate-evidence verifier', () => {
    const r = runHook(
      'stop-evidence-guard.mjs',
      { hook_event_name: 'Stop', last_assistant_message: 'task complete' },
      { ARBITER_EVIDENCE_HARNESS: '1' },
    )
    expect(r.stderr).not.toMatch(LOAD_FAILURE)
    expect(r.status).toBe(2)
  })

  it('stop-evidence-guard.mjs loads the evidence-binding verifier', () => {
    writePassingPlanReview()
    const r = runHook(
      'stop-evidence-guard.mjs',
      { hook_event_name: 'Stop', last_assistant_message: 'task complete' },
      { ARBITER_EVIDENCE_HARNESS: '0' },
    )
    expect(r.stderr).not.toMatch(LOAD_FAILURE)
    expect(r.stderr).toMatch(/dispatch evidence missing/)
    expect(r.status).toBe(2)
  })

  describe('fail-closed when a verifier is genuinely absent', () => {
    function removeShippedVerifiers(): void {
      for (const f of ['gate-evidence.mjs', 'evidence-binding.mjs']) {
        rmSync(join(pluginHooks, f), { force: true })
      }
    }

    it('enforce-gate-before-pr.mjs blocks with "could not be loaded"', () => {
      removeShippedVerifiers()
      writeJson('.arbiter/gate-pass.json', {})
      const r = runHook('enforce-gate-before-pr.mjs', { tool_input: { command: 'gh pr create' } })
      expect(r.stderr).toMatch(/could not be loaded/)
      expect(r.status).toBe(2)
    })

    it('guard-done-evidence.mjs blocks with "verifier unavailable"', () => {
      removeShippedVerifiers()
      const r = runHook(
        'guard-done-evidence.mjs',
        { hook_event_name: 'Stop', last_assistant_message: 'task complete' },
        { ARBITER_EVIDENCE_HARNESS: '1' },
      )
      expect(r.stderr).toMatch(/verifier unavailable/)
      expect(r.status).toBe(2)
    })

    it('stop-evidence-guard.mjs blocks with "verifier unavailable"', () => {
      removeShippedVerifiers()
      writePassingPlanReview()
      const r = runHook(
        'stop-evidence-guard.mjs',
        { hook_event_name: 'Stop', last_assistant_message: 'task complete' },
        { ARBITER_EVIDENCE_HARNESS: '0' },
      )
      expect(r.stderr).toMatch(/evidence binding verifier unavailable/)
      expect(r.status).toBe(2)
    })
  })
})
