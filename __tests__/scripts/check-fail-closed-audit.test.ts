import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
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

const SCHEMA = 'arbiter-fail-closed-baseline-v2'

/** #2418: ISO day offset from today, for expiry fixtures. */
function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
}

type BaselineEntry = {
  file: string
  since?: string
  owner?: string
  expires?: string
  permanent?: string
}

function writeBaselineFile(root: string, files: unknown[], schema = SCHEMA): void {
  writeFileSync(
    join(root, 'scripts', 'data', 'fail-closed-baseline.json'),
    JSON.stringify({ schema, generated_at: null, files }),
  )
}

/** A well-formed v2 row: dated, owned, expiring inside the 90-day window. */
function row(file: string, over: Partial<BaselineEntry> = {}): BaselineEntry {
  return { file, since: day(-30), owner: 'LucaDominici', expires: day(30), ...over }
}

function makeRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'fail-closed-test-'))
  // create the directory structure the audit walks
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'scripts', 'data'), { recursive: true })
  mkdirSync(join(root, '.githooks'), { recursive: true })
  mkdirSync(join(root, '.claude', 'hooks'), { recursive: true })
  // empty baseline so every finding counts as new
  writeBaselineFile(root, [])
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
    writeBaselineFile(env.root, [row('scripts/legacy.sh')])
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
    const r = runAudit(env.root, ['--update-baseline', '--owner', 'LucaDominici'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('baseline updated')
  })

  // ── #2418: a catch that delegates to a file-local TERMINAL helper is surfacing ──
  // The `fail(msg)` / `invoke(msg)` convention (write to stderr, exit non-zero) is the
  // dominant shape across the meta-check family. The textual detector could not see
  // through the call, so every script using it was forced into the baseline.

  it('does NOT flag a catch that delegates to a file-local fail() helper', () => {
    writeFileSync(
      join(env.root, 'scripts', 'delegating.mjs'),
      [
        '#!/usr/bin/env node',
        'function fail(msg) {',
        '  process.stderr.write(`FAIL: ${msg}\\n`)',
        '  process.exit(1)',
        '}',
        'try {',
        '  doThing()',
        '} catch (e) {',
        '  fail(e.message)',
        '}',
      ].join('\n'),
    )
    expect(runAudit(env.root).status).toBe(0)
  })

  it('still flags a catch that delegates to a helper which merely returns', () => {
    writeFileSync(
      join(env.root, 'scripts', 'soft-helper.mjs'),
      [
        '#!/usr/bin/env node',
        'function quiet(msg) {',
        '  return msg',
        '}',
        'function run() {',
        '  try {',
        '    return doThing()',
        '  } catch (e) {',
        '    quiet(e)',
        '  }',
        '}',
        'try { run() } catch (e) { console.error(e); process.exit(1) }',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('soft-helper.mjs')
    expect(r.stdout).toContain('node-swallowed-catch')
  })

  it('still flags a catch delegating to a helper that only CONDITIONALLY exits', () => {
    writeFileSync(
      join(env.root, 'scripts', 'maybe-exit.mjs'),
      [
        '#!/usr/bin/env node',
        'function maybeFail(msg) {',
        '  if (!msg) return',
        '  process.exit(1)',
        '}',
        'function run() {',
        '  try {',
        '    return doThing()',
        '  } catch (e) {',
        '    maybeFail(e.message)',
        '  }',
        '}',
        'try { run() } catch (e) { console.error(e); process.exit(1) }',
      ].join('\n'),
    )
    const r = runAudit(env.root)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('maybe-exit.mjs')
  })

  // ── #2418: the baseline is dated, owned and decaying — not an open-ended ledger ──

  describe('#2418 baseline policy', () => {
    /** A file that violates, so the baseline has something legitimate to grandfather. */
    function writeViolator(rel = 'scripts/legacy.sh'): void {
      writeFileSync(
        join(env.root, rel),
        ['#!/usr/bin/env bash', '', 'do-thing || true', ''].join('\n'),
      )
    }

    it('rejects a v1 (bare string) baseline as malformed, naming the v2 schema', () => {
      writeViolator()
      writeBaselineFile(env.root, ['scripts/legacy.sh'], 'arbiter-fail-closed-baseline-v1')
      const r = runAudit(env.root)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('arbiter-fail-closed-baseline-v2')
    })

    it('rejects a row with no owner', () => {
      writeViolator()
      writeBaselineFile(env.root, [{ file: 'scripts/legacy.sh', since: day(-1), expires: day(30) }])
      const r = runAudit(env.root)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('owner')
    })

    it('rejects a row with no `since` date', () => {
      writeViolator()
      writeBaselineFile(env.root, [row('scripts/legacy.sh', { since: undefined })])
      const r = runAudit(env.root)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('since')
    })

    it('rejects a row carrying BOTH an expiry and a permanent rationale', () => {
      writeViolator()
      writeBaselineFile(env.root, [
        row('scripts/legacy.sh', { permanent: 'vendored third-party installer, never ours' }),
      ])
      const r = runAudit(env.root)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('permanent')
    })

    it('rejects a permanent row whose rationale is a token word', () => {
      writeViolator()
      writeBaselineFile(env.root, [
        row('scripts/legacy.sh', { expires: undefined, permanent: 'legacy' }),
      ])
      const r = runAudit(env.root)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('permanent')
    })

    it('accepts a permanent row with a real rationale', () => {
      writeViolator()
      writeBaselineFile(env.root, [
        row('scripts/legacy.sh', {
          expires: undefined,
          permanent: 'vendored upstream installer; arbiter never edits it',
        }),
      ])
      expect(runAudit(env.root).status).toBe(0)
    })

    it('FAILS the gate on an expired row', () => {
      writeViolator()
      writeBaselineFile(env.root, [row('scripts/legacy.sh', { expires: day(-1) })])
      const r = runAudit(env.root)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('expired')
      expect(r.stdout).toContain('scripts/legacy.sh')
    })

    it('FAILS the gate on a window longer than 90 days', () => {
      writeViolator()
      writeBaselineFile(env.root, [row('scripts/legacy.sh', { expires: day(120) })])
      const r = runAudit(env.root)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('90 days')
    })

    it('FAILS the gate on a stale row whose file no longer violates (ratchet)', () => {
      writeFileSync(
        join(env.root, 'scripts', 'clean.sh'),
        ['#!/usr/bin/env bash', 'set -euo pipefail', '', 'do-thing', ''].join('\n'),
      )
      writeBaselineFile(env.root, [row('scripts/clean.sh')])
      const r = runAudit(env.root)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('scripts/clean.sh')
      expect(r.stdout).toContain('no longer')
    })

    it('FAILS the gate on a row whose file was deleted', () => {
      writeBaselineFile(env.root, [row('scripts/ghost.mjs')])
      const r = runAudit(env.root)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('scripts/ghost.mjs')
    })

    it('refuses to grandfather a NEW file without --owner', () => {
      writeViolator()
      const r = runAudit(env.root, ['--update-baseline'])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('--owner')
    })

    it('--update-baseline stamps a new row with since + owner + a ≤90-day expiry', () => {
      writeViolator()
      expect(runAudit(env.root, ['--update-baseline', '--owner', 'LucaDominici']).status).toBe(0)
      const written = JSON.parse(
        readFileSync(join(env.root, 'scripts', 'data', 'fail-closed-baseline.json'), 'utf-8'),
      ) as { schema: string; files: BaselineEntry[] }
      expect(written.schema).toBe(SCHEMA)
      const [entry] = written.files
      expect(entry.file).toBe('scripts/legacy.sh')
      expect(entry.owner).toBe('LucaDominici')
      expect(entry.since).toBe(day(0))
      const days = (Date.parse(`${entry.expires}T00:00:00Z`) - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(0)
      expect(days).toBeLessThanOrEqual(90)
      expect(runAudit(env.root).status).toBe(0)
    })

    it('--update-baseline preserves an existing row verbatim (regeneration never renews)', () => {
      writeViolator()
      const pinned = row('scripts/legacy.sh', {
        since: '2026-05-21',
        owner: 'SomeoneElse',
        expires: day(3),
      })
      writeBaselineFile(env.root, [pinned])
      expect(runAudit(env.root, ['--update-baseline', '--owner', 'LucaDominici']).status).toBe(0)
      const written = JSON.parse(
        readFileSync(join(env.root, 'scripts', 'data', 'fail-closed-baseline.json'), 'utf-8'),
      ) as { files: BaselineEntry[] }
      expect(written.files).toEqual([pinned])
    })

    it('--update-baseline drops the row of a file that no longer violates', () => {
      writeFileSync(
        join(env.root, 'scripts', 'clean.sh'),
        ['#!/usr/bin/env bash', 'set -euo pipefail', '', 'do-thing', ''].join('\n'),
      )
      writeBaselineFile(env.root, [row('scripts/clean.sh')])
      expect(runAudit(env.root, ['--update-baseline', '--owner', 'LucaDominici']).status).toBe(0)
      const written = JSON.parse(
        readFileSync(join(env.root, 'scripts', 'data', 'fail-closed-baseline.json'), 'utf-8'),
      ) as { files: BaselineEntry[] }
      expect(written.files).toEqual([])
    })
  })
})
