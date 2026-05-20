import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-fail-closed-audit.mjs')

type RunResult = {
  status: number
  stdout: string
  stderr: string
}

function runAudit(root: string, extraArgs: string[] = []): RunResult {
  const result = spawnSync('node', [SCRIPT, '--root', root, ...extraArgs], {
    encoding: 'utf-8',
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function makeRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'fail-closed-test-'))
  // create the directory structure the audit walks
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'scripts', 'data'), { recursive: true })
  mkdirSync(join(root, '.githooks'), { recursive: true })
  mkdirSync(join(root, '.claude', 'hooks'), { recursive: true })
  // empty baseline so every finding counts as new
  writeFileSync(
    join(root, 'scripts', 'data', 'fail-closed-baseline.json'),
    JSON.stringify({ schema: 'arbiter-fail-closed-baseline-v1', generated_at: null, files: [] }),
  )
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

describe('check-fail-closed-audit', () => {
  let env: { root: string; cleanup: () => void }
  beforeEach(() => {
    env = makeRoot()
  })
  afterEach(() => env.cleanup())

  it('flags a bash script with `|| true` on a critical line', () => {
    writeFileSync(
      join(env.root, 'scripts', 'bad-bash.sh'),
      ['#!/usr/bin/env bash', 'set -euo pipefail', '', 'do-thing || true', ''].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('bad-bash.sh')
    expect(r.stdout).toContain('bash-or-true')
  })

  it('passes when `|| true` is preceded by FAIL-OPEN-INTENT marker', () => {
    writeFileSync(
      join(env.root, 'scripts', 'allowlisted.sh'),
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '',
        '# FAIL-OPEN-INTENT: cleanup is best-effort',
        'rm -rf .tmp || true',
        '',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(0)
  })

  it('passes a clean bash script with set -euo pipefail and no || true', () => {
    writeFileSync(
      join(env.root, 'scripts', 'clean.sh'),
      ['#!/usr/bin/env bash', 'set -euo pipefail', '', 'do-thing', ''].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(0)
  })

  it('fails a bash script that is missing `set -euo pipefail`', () => {
    writeFileSync(
      join(env.root, 'scripts', 'unsafe.sh'),
      ['#!/usr/bin/env bash', '', 'do-thing', 'do-other-thing', ''].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('unsafe.sh')
    expect(r.stdout).toContain('bash-no-pipefail')
  })

  it('fails a node script with bare swallowed `catch {}`', () => {
    writeFileSync(
      join(env.root, 'scripts', 'swallowed.mjs'),
      [
        '#!/usr/bin/env node',
        "import { runCheck } from '../scripts/lib/run-helpers.mjs'",
        '',
        'try {',
        '  runCheck("x", "true", [])',
        '} catch (e) {}',
        '',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('swallowed.mjs')
    expect(r.stdout).toContain('node-swallowed-catch')
  })

  it('passes a node script that uses runCheck helper', () => {
    writeFileSync(
      join(env.root, 'scripts', 'helper-user.mjs'),
      [
        '#!/usr/bin/env node',
        "import { runCheck } from '../scripts/lib/run-helpers.mjs'",
        '',
        "runCheck('typecheck', 'tsc', ['--noEmit'])",
        '',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(0)
  })

  it('passes a node script that wraps its entry block in try/catch with process.exit(1)', () => {
    writeFileSync(
      join(env.root, 'scripts', 'try-catch.mjs'),
      [
        '#!/usr/bin/env node',
        '',
        'try {',
        "  console.log('hello')",
        '} catch (err) {',
        '  console.error(err)',
        '  process.exit(1)',
        '}',
        '',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(0)
  })

  it('flags a node script with no error handling and no helper usage', () => {
    writeFileSync(
      join(env.root, 'scripts', 'reckless.mjs'),
      ['#!/usr/bin/env node', '', "console.log('hello')", 'process.exit(0)', ''].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('reckless.mjs')
    expect(r.stdout).toContain('node-no-error-handling')
  })

  it('grandfathers baseline files even if they violate the contract', () => {
    writeFileSync(
      join(env.root, 'scripts', 'legacy.sh'),
      ['#!/usr/bin/env bash', '', 'do-thing || true', ''].join('\n'),
    )
    writeFileSync(
      join(env.root, 'scripts', 'data', 'fail-closed-baseline.json'),
      JSON.stringify({
        schema: 'arbiter-fail-closed-baseline-v1',
        generated_at: null,
        files: ['scripts/legacy.sh'],
      }),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(0)
  })

  it('writes a baseline file with --update-baseline', () => {
    writeFileSync(
      join(env.root, 'scripts', 'bad.sh'),
      ['#!/usr/bin/env bash', '', 'do-thing || true', ''].join('\n'),
    )
    const r = runAudit(env.root, ['--update-baseline'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('baseline updated')
  })
})
