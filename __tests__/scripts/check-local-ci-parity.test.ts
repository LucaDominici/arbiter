// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Covers the RUNTIME branch of check-local-ci-parity.mjs (local-result.json
// parsing + schema validation + neutral skips). The static Makefile↔workflow
// branch is exercised separately in check-local-ci-parity.static.test.ts.
//
// Exit-code contract (from the script header):
//   0 — hashes match, or neutral skip (no local result / no CI artifact / not a git repo)
//   1 — parity drift detected
//   2 — invocation error (unparseable local result, bad schema)
const SCRIPT = join(process.cwd(), 'scripts', 'check-local-ci-parity.mjs')

function runParity(cwd: string): { status: number; stdout: string; stderr: string } {
  // No PARITY_STATIC_CHECK_ONLY → full pipeline: static check, then runtime check.
  const result = spawnSync('node', [SCRIPT], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env },
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

// Build a fixture whose static Makefile↔workflow check passes, so execution
// proceeds into the runtime (local-result.json) branch under test.
function writeStaticPassingScaffold(dir: string): void {
  const targets = ['check', 'gate', 'ci']
  const phony = `.PHONY: ${targets.join(' ')}\n`
  const rules = targets.map((t) => `${t}:\n\techo ${t}\n`).join('\n')
  writeFileSync(join(dir, 'Makefile'), phony + '\n' + rules)

  const wfDir = join(dir, '.github', 'workflows')
  mkdirSync(wfDir, { recursive: true })
  const jobBlock = targets
    .map((j) => `  ${j}:\n    runs-on: ubuntu-latest\n    steps: []\n`)
    .join('')
  writeFileSync(join(wfDir, 'ci.yml'), `name: CI\non: [push]\njobs:\n${jobBlock}`)
}

function writeLocalResult(dir: string, content: string): void {
  const gateDir = join(dir, '.arbiter', 'gate')
  mkdirSync(gateDir, { recursive: true })
  writeFileSync(join(gateDir, 'local-result.json'), content)
}

describe('check-local-ci-parity.mjs — runtime local↔CI parity check (INV-59, INV-87)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-parity-rt-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('static OK + no local gate result → neutral skip (exit 0)', () => {
    writeStaticPassingScaffold(dir)
    const r = runParity(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('static parity OK')
    expect(r.stdout).toMatch(/no local gate result/i)
    expect(r.stdout).toContain('SKIP (neutral)')
  })

  it('unparseable local-result.json → invocation error (exit 2)', () => {
    writeStaticPassingScaffold(dir)
    writeLocalResult(dir, 'not json{')
    const r = runParity(dir)
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/cannot parse/i)
  })

  it('local-result.json with wrong schema → invocation error (exit 2)', () => {
    writeStaticPassingScaffold(dir)
    writeLocalResult(dir, JSON.stringify({ schema: 'wrong-schema-v9' }))
    const r = runParity(dir)
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/unexpected schema/i)
  })

  it('static drift in full pipeline → exit 1 before runtime branch', () => {
    // Makefile declares a target absent from every workflow job → static drift.
    // The full pipeline (lines 131–134) propagates exit 1 from the static check
    // before the runtime local-result.json branch is ever reached.
    const targets = ['check', 'gate', 'ci', 'extra-local-target']
    const phony = `.PHONY: ${targets.join(' ')}\n`
    const rules = targets.map((t) => `${t}:\n\techo ${t}\n`).join('\n')
    writeFileSync(join(dir, 'Makefile'), phony + '\n' + rules)
    const wfDir = join(dir, '.github', 'workflows')
    mkdirSync(wfDir, { recursive: true })
    const jobBlock = ['check', 'gate', 'ci']
      .map((j) => `  ${j}:\n    runs-on: ubuntu-latest\n    steps: []\n`)
      .join('')
    writeFileSync(join(wfDir, 'ci.yml'), `name: CI\non: [push]\njobs:\n${jobBlock}`)
    // A local result is present, but the static failure must short-circuit first.
    writeLocalResult(dir, JSON.stringify({ schema: 'arbiter-gate-v1', parityContentHash: 'x' }))
    const r = runParity(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('extra-local-target')
  })

  it('valid local result but not a git repo → neutral skip (exit 0)', () => {
    // The temp dir is not a git repo, so `git rev-parse` fails and the script
    // skips before any network/gh call — keeping the test deterministic & offline.
    writeStaticPassingScaffold(dir)
    writeLocalResult(
      dir,
      JSON.stringify({ schema: 'arbiter-gate-v1', parityContentHash: 'deadbeef' }),
    )
    const r = runParity(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('SKIP (neutral)')
  })
})
