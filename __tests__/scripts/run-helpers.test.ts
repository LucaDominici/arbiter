// Tests for the run-helpers trinity (#351, CANON-01)
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as runHelpersMod from '../../scripts/lib/run-helpers.mjs'

const HELPERS = pathToFileURL(resolve('scripts/lib/run-helpers.mjs')).href

function runHarness(script: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    shell: false,
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
}

describe('run-helpers — runCheck (HARD)', () => {
  it('records PASS and does not increment failed when command exits 0', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('ok', process.execPath, ['-e', 'process.exit(0)']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    expect(r.status).toBe(0)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toMatchObject({ name: 'ok', status: 'PASS' })
  })

  it('records FAIL and increments failed when command exits non-zero', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('bad', process.execPath, ['-e', 'process.exit(7)']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(1)
    expect(payload.results[0]).toMatchObject({ name: 'bad', status: 'FAIL' })
  })

  it('records FAIL on ENOENT (missing binary)', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('absent', 'this-binary-does-not-exist-arbiter-351', []);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(1)
    expect(payload.results[0]).toMatchObject({ name: 'absent', status: 'FAIL' })
  })

  it('records FAIL with an actionable buffer message when command output exceeds maxBuffer', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('chatty', process.execPath, ['-e', "process.stdout.write('x'.repeat(1024))"], { maxBufferBytes: 8 });
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    expect(r.stdout).toContain('output exceeded buffer')
    expect(r.stdout).not.toContain('exit null')
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(1)
    expect(payload.results[0]).toMatchObject({ name: 'chatty', status: 'FAIL' })
  })

  it('soft option: failing command becomes WARN, failed not incremented', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('soft-bad', process.execPath, ['-e', 'process.exit(3)'], { soft: true });
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toMatchObject({ name: 'soft-bad', status: 'WARN' })
  })

  // #2052: a check that self-skips (exit 0 + a `[SKIP] <reason>` marker line on
  // its own stdout) must surface as SKIP, not PASS — otherwise a permanently
  // mis-wired check reads as evergreen-green forever.
  it('exit 0 + `[SKIP] reason` marker records SKIP, not PASS, and does not fail the gate', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('self-skip', process.execPath, ['-e', "console.log('[SKIP] no config found')"]);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    expect(r.stdout).toContain('SKIP (no config found')
    expect(r.stdout).not.toContain('PASS')
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toMatchObject({ name: 'self-skip', status: 'SKIP' })
  })

  it('exit 0 + `[SKIP]` marker with no reason text still records SKIP with a fallback message', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('bare-skip', process.execPath, ['-e', "console.log('[SKIP]')"]);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.results[0]).toMatchObject({ name: 'bare-skip', status: 'SKIP' })
  })

  it('a genuinely passing check that only mentions "skip" in prose still records PASS (no false-positive)', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('mentions-skip', process.execPath, ['-e', "console.log('note: SKIP_EXTENSIONS=1 handled, 3 files checked')"]);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.results[0]).toMatchObject({ name: 'mentions-skip', status: 'PASS' })
  })

  it('an indented "[SKIP]" (not at line start) does not trigger self-skip — PASS stands', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('nested-skip-note', process.execPath, ['-e', "console.log('  SKIP (exception): item-42')"]);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.results[0]).toMatchObject({ name: 'nested-skip-note', status: 'PASS' })
  })
})

describe('run-helpers — runWarnCheck (informational)', () => {
  it('failing warn check records WARN and does NOT increment failed', () => {
    const r = runHarness(`
      import { runWarnCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runWarnCheck('warn-bad', process.execPath, ['-e', 'process.exit(2)']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toMatchObject({ name: 'warn-bad', status: 'WARN' })
  })

  it('passing warn check still records PASS', () => {
    const r = runHarness(`
      import { runWarnCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runWarnCheck('warn-ok', process.execPath, ['-e', 'process.exit(0)']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toMatchObject({ name: 'warn-ok', status: 'PASS' })
  })
})

describe('run-helpers — runToolCheck (CI-aware tool gate)', () => {
  it('locally (CI unset) — missing tool records SKIP and does NOT fail', () => {
    const r = runHarness(
      `
      import { runToolCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runToolCheck('phantom-tool', 'this-binary-does-not-exist-arbiter-351', ['--version']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `,
      { CI: '', GITHUB_ACTIONS: '' },
    )
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toMatchObject({ name: 'phantom-tool', status: 'SKIP' })
  })

  it('in CI (CI=true) — missing tool records FAIL and increments failed', () => {
    const r = runHarness(
      `
      import { runToolCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runToolCheck('phantom-tool', 'this-binary-does-not-exist-arbiter-351', ['--version']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `,
      { CI: 'true' },
    )
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(1)
    expect(payload.results[0]).toMatchObject({ name: 'phantom-tool', status: 'FAIL' })
  })

  it('tool present + exit 0 records PASS regardless of CI', () => {
    const r = runHarness(`
      import { runToolCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runToolCheck('node-tool', process.execPath, ['-e', 'process.exit(0)']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toMatchObject({ name: 'node-tool', status: 'PASS' })
  })

  it('tool present but fails — FAIL and increments failed', () => {
    const r = runHarness(`
      import { runToolCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runToolCheck('node-tool', process.execPath, ['-e', 'process.exit(5)']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const last = r.stdout.trim().split('\n').pop()!
    const payload = JSON.parse(last)
    expect(payload.failed).toBe(1)
    expect(payload.results[0]).toMatchObject({ name: 'node-tool', status: 'FAIL' })
  })
})

describe('run-helpers — module shape', () => {
  it('exposes named exports', () => {
    const mod = runHelpersMod
    expect(typeof mod.runCheck).toBe('function')
    expect(typeof mod.runWarnCheck).toBe('function')
    expect(typeof mod.runToolCheck).toBe('function')
    expect(typeof mod.getResults).toBe('function')
    expect(typeof mod.getFailed).toBe('function')
    expect(typeof mod.resetState).toBe('function')
  })
})

describe('run-helpers — pushResult (custom-classified gates)', () => {
  it('PASS pushed: failed unchanged, result appended', () => {
    const r = runHarness(`
      import { pushResult, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      pushResult('custom-ok', 'PASS', 42);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const payload = JSON.parse(r.stdout.trim().split('\n').pop()!)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toEqual({ name: 'custom-ok', status: 'PASS', elapsed: 42 })
  })

  it('FAIL pushed: failed++ and result appended', () => {
    const r = runHarness(`
      import { pushResult, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      pushResult('custom-bad', 'FAIL', 13);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const payload = JSON.parse(r.stdout.trim().split('\n').pop()!)
    expect(payload.failed).toBe(1)
    expect(payload.results[0]).toEqual({ name: 'custom-bad', status: 'FAIL', elapsed: 13 })
  })

  it('WARN pushed: failed unchanged', () => {
    const r = runHarness(`
      import { pushResult, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      pushResult('custom-warn', 'WARN', 7);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const payload = JSON.parse(r.stdout.trim().split('\n').pop()!)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toEqual({ name: 'custom-warn', status: 'WARN', elapsed: 7 })
  })

  it('SKIP pushed: failed unchanged', () => {
    const r = runHarness(`
      import { pushResult, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      pushResult('custom-skip', 'SKIP', 3);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const payload = JSON.parse(r.stdout.trim().split('\n').pop()!)
    expect(payload.failed).toBe(0)
    expect(payload.results[0]).toEqual({ name: 'custom-skip', status: 'SKIP', elapsed: 3 })
  })
})
