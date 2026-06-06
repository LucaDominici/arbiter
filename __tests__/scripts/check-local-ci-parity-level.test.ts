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
    // actionlint is in CI_SKIP_SET — should not fail parity
    writeCheckAllStub(dir, ['actionlint'])
    const r = runCheckLevel(dir)
    expect(r.status).toBe(0)
  })

  it('all checks in CI_COVERAGE exits 0', () => {
    // 'unit tests' maps to gate-full — covered
    writeCheckAllStub(dir, ['unit tests', 'coverage', 'gitleaks'])
    const r = runCheckLevel(dir)
    expect(r.status).toBe(0)
  })

  it('no scripts/check-all.mjs → neutral skip (exit 0)', () => {
    // No check-all.mjs in fixture → skip gracefully
    const r = runCheckLevel(dir)
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toMatch(/skip/i)
  })
})
