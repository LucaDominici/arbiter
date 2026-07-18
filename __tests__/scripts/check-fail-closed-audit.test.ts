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

  // ── #1537: broadened swallow detection (non-empty swallows must not slip) ──────

  it('flags `catch { return null }` (defaulting swallow, previously passed)', () => {
    writeFileSync(
      join(env.root, 'scripts', 'ret-null.mjs'),
      [
        '#!/usr/bin/env node',
        'function f() {',
        '  try {',
        '    return risky()',
        '  } catch {',
        '    return null',
        '  }',
        '}',
        'f()',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('ret-null.mjs')
    expect(r.stdout).toContain('node-swallowed-catch')
  })

  it('flags comment-only `catch { // ignore }` (passes ESLint no-empty, slips the old regex)', () => {
    writeFileSync(
      join(env.root, 'scripts', 'comment-only.mjs'),
      [
        '#!/usr/bin/env node',
        'try {',
        '  doThing()',
        '} catch {',
        '  // ignore malformed input',
        '}',
        'process.exit(0)',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('comment-only.mjs')
    expect(r.stdout).toContain('node-swallowed-catch')
  })

  it('flags `catch { continue }` swallow', () => {
    writeFileSync(
      join(env.root, 'scripts', 'cont.mjs'),
      [
        '#!/usr/bin/env node',
        'for (const x of list) {',
        '  try {',
        '    parse(x)',
        '  } catch {',
        '    continue',
        '  }',
        '}',
        'process.exit(0)',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('cont.mjs')
  })

  it('does NOT flag a catch that rethrows', () => {
    writeFileSync(
      join(env.root, 'scripts', 'rethrow.mjs'),
      ['#!/usr/bin/env node', 'try {', '  doThing()', '} catch (e) {', '  throw e', '}'].join('\n'),
    )
    expect(runAudit(env.root).status).toBe(0)
  })

  it('does NOT flag a catch that surfaces via console.error', () => {
    writeFileSync(
      join(env.root, 'scripts', 'surface.mjs'),
      [
        '#!/usr/bin/env node',
        'function f() {',
        '  try {',
        '    return risky()',
        '  } catch (e) {',
        '    console.error(e)',
        '    return null',
        '  }',
        '}',
        'try { f() } catch (e) { console.error(e); process.exit(1) }',
      ].join('\n'),
    )
    expect(runAudit(env.root).status).toBe(0)
  })

  it('suppresses a swallow tagged with // FAIL-OPEN-INTENT on the line above the catch', () => {
    writeFileSync(
      join(env.root, 'scripts', 'intentional.mjs'),
      [
        '#!/usr/bin/env node',
        'function f() {',
        '  try {',
        '    bestEffort()',
        '    // FAIL-OPEN-INTENT: telemetry is best-effort, never blocks',
        '  } catch {',
        '    return null',
        '  }',
        '}',
        // top-level handler satisfies the entry-script contract and is not a swallow
        'try { f() } catch (e) { console.error(e); process.exit(1) }',
      ].join('\n'),
    )
    expect(runAudit(env.root).status).toBe(0)
  })

  it('does NOT flag a swallow inside a string or comment (no self-match)', () => {
    writeFileSync(
      join(env.root, 'scripts', 'documented.mjs'),
      [
        '#!/usr/bin/env node',
        '// example of a forbidden shape: catch { return null }',
        "const doc = 'a catch { } that is just text'",
        'console.log(doc)',
        'try { main() } catch (e) { console.error(e); process.exit(1) }',
      ].join('\n'),
    )
    expect(runAudit(env.root).status).toBe(0)
  })

  it('scans src/ for swallows but does NOT require entry-point error handling there', () => {
    mkdirSync(join(env.root, 'src'), { recursive: true })
    // A library module with no top-level try/catch is fine (not an entry script)...
    writeFileSync(
      join(env.root, 'src', 'clean-lib.ts'),
      ['export function add(a: number, b: number): number {', '  return a + b', '}'].join('\n'),
    )
    expect(runAudit(env.root).status).toBe(0)
    // ...but a defaulting swallow in a src/ module IS caught.
    writeFileSync(
      join(env.root, 'src', 'swallow-lib.ts'),
      [
        'export function load(): unknown {',
        '  try {',
        '    return parse()',
        '  } catch {',
        '    return undefined',
        '  }',
        '}',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('src/swallow-lib.ts')
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
