// SPDX-License-Identifier: Apache-2.0
// Red tests for #1225 check-level parity (branch 3 in check-local-ci-parity.mjs).
// These fail with the current code (no check-level parity branch exists).
// Green after: check-local-ci-parity.mjs gains a check-level parity check
// triggered by PARITY_CHECK_LEVEL_ONLY=1 env var (mirrors PARITY_STATIC_CHECK_ONLY=1).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = join(process.cwd(), 'scripts', 'check-local-ci-parity.mjs')

function runCheckLevel(
  cwd: string,
  env?: Record<string, string>,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, PARITY_CHECK_LEVEL_ONLY: '1', ...env },
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** Write a check-all.mjs stub with the given runCheck call names. */
function writeCheckAllStub(dir: string, checkNames: string[]): void {
  const calls = checkNames
    .map((n) => `  runCheck(${JSON.stringify(n)}, 'node', ['--version'])`)
    .join('\n')
  const content = `#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
function runCheck(name, cmd, args) { void name; void cmd; void args; }
function runToolCheck(name, cmd) { void name; void cmd; }
${calls}
`
  const scriptsDir = join(dir, 'scripts')
  mkdirSync(scriptsDir, { recursive: true })
  writeFileSync(join(scriptsDir, 'check-all.mjs'), content)
}

describe('check-local-ci-parity.mjs — check-level parity (#1225)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-cl-parity-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('orphan check (not in CI_COVERAGE or CI_SKIP_SET) exits 1', () => {
    writeCheckAllStub(dir, ['unit tests', 'orphan-check'])
    const r = runCheckLevel(dir)
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toMatch(/orphan-check/)
    expect(r.stderr + r.stdout).toMatch(/no CI counterpart/i)
  })

  it('all checks in CI_SKIP_SET exits 0', () => {
    // 'self-validation drill' is in CI_SKIP_SET — should not fail parity
    writeCheckAllStub(dir, ['self-validation drill'])
    const r = runCheckLevel(dir)
    expect(r.status).toBe(0)
  })

  it('all checks in CI_COVERAGE exits 0', () => {
    // 'unit tests', 'actionlint' map to gate-full — covered
    writeCheckAllStub(dir, ['unit tests', 'coverage', 'gitleaks', 'actionlint'])
    const r = runCheckLevel(dir)
    expect(r.status).toBe(0)
  })

  it('no scripts/check-all.mjs → neutral skip (exit 0)', () => {
    // No check-all.mjs in fixture → skip gracefully
    const r = runCheckLevel(dir)
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/skip/i)
  })

  // RT-06: check-level parity must run in the NORMAL path (no env flag), BEFORE
  // the local-result.json guard — otherwise it is dead code in CI (clean checkout
  // has no local-result.json). This drives an orphan check failure with NO
  // PARITY_CHECK_LEVEL_ONLY set, proving the unconditional call exists.
  it('runs in the normal path without PARITY_CHECK_LEVEL_ONLY (RT-06: not dead code)', () => {
    writeCheckAllStub(dir, ['unit tests', 'orphan-rt06'])
    // Provide a passing static scaffold so we get past the static check into
    // the check-level branch (which precedes the local-result guard).
    const phony = '.PHONY: check gate ci\ncheck:\n\techo check\n'
    writeFileSync(join(dir, 'Makefile'), phony)
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(
      join(dir, '.github', 'workflows', 'ci.yml'),
      'name: CI\non: [push]\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps: []\n  gate:\n    runs-on: ubuntu-latest\n    steps: []\n  ci:\n    runs-on: ubuntu-latest\n    steps: []\n',
    )
    // NO PARITY_CHECK_LEVEL_ONLY — full pipeline.
    const result = spawnSync('node', [SCRIPT], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, PARITY_CHECK_LEVEL_ONLY: '' },
    })
    expect(result.status).toBe(1)
    expect((result.stderr ?? '') + (result.stdout ?? '')).toMatch(/orphan-rt06/)
  })
})
