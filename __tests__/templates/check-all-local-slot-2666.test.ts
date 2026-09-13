// #2666 — declared extension slot for project-local checks in the gate spine.
//
// `scripts/check-all.local.json` is a never-emitted, optional PLAIN DATA file:
// no template renders it, so it is absent from `.arbiter-generated-manifest.json`
// and never classified gate-spine/safety by src/generators/safety-class.ts — the
// exact property that lets it survive `arbiter update`/`--adopt-gate-spine`
// untouched (AC1, AC2). Declarative JSON, not an executable module (Codex
// review, round 3): two earlier designs here (a direct `import()` of a .mjs
// module, then a child-process + nonce handoff) were both defeated because any
// in-process trust placed in a LOADED CODE MODULE is forgeable. `JSON.parse`
// either returns data or throws — there is no third option and nothing for the
// data to forge. check-all.mjs.ejs parses it and dispatches each entry through
// the standard runCheck trio, labeled `[local] <name>`, so it participates in
// the summary table and the arbiter-gate-v1 parityGates the same way a registry
// gate does (AC3).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { loadGateRegistry } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'
import { isGateSpineKey, isSafetyClassKey } from '../../src/generators/safety-class.js'

function render(): string {
  const cfg = makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
    coverageEnabled: false,
  }) as unknown as Record<string, unknown>
  const data = {
    ...cfg,
    coverageThreshold: 80,
    coverageEnabled: false,
    mutationEnabled: false,
    isL2Plus: true,
    isL3Plus: false,
    isL4: false,
  }
  return renderTemplate('scripts/check-all.mjs.ejs', {
    ...data,
    gates: loadGateRegistry(data),
  })
}

describe('AC2 — scripts/check-all.local.json is not a protected class', () => {
  it('is neither gate-spine nor safety-class, so --adopt-gate-spine/diff never touch it', () => {
    expect(isGateSpineKey('scripts/check-all.local.json')).toBe(false)
    expect(isSafetyClassKey('scripts/check-all.local.json')).toBe(false)
  })
})

describe('AC1/AC3 — check-all.mjs.ejs loads the local slot', () => {
  it('renders the local-slot loader referencing check-all.local.json (no module import)', () => {
    const content = render()
    expect(content).toContain('check-all.local.json')
    expect(content).toContain('[local] ')
    // Declarative only — no dynamic import()/child bootstrap of the slot file.
    expect(content).not.toContain('check-all.local.mjs')
  })
})

// Runtime proof: slice the rendered script from the top through the Summary
// section (mirrors the #1720/#2078 slice-and-run harness), stub run-helpers to
// capture pushResult/runCheck calls, and exercise the local-slot loader end to
// end in a temp project directory.
function runLocalSlotHarness(
  localFileSource: string | null,
  args: string[] = ['L2'],
  env: Record<string, string> = { ARBITER_ALLOW_LOCAL_CHECKS: '1' },
): { status: number | null; stdout: string; stderr: string } {
  const content = render()
  const cutIdx = content.indexOf('// ─── Summary')
  const prefix = content.slice(0, cutIdx)
  const dir = mkdtempSync(join(tmpdir(), 'arb-local-slot-'))
  try {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(join(scriptsDir, 'lib'), { recursive: true })
    writeFileSync(
      join(scriptsDir, 'lib', 'run-helpers.mjs'),
      [
        'export function runCheck(name, cmd, args) {',
        '  console.log(`RUNCHECK:${JSON.stringify({ name, cmd, args })}`);',
        '  pushResult(name, "PASS", 0);',
        '}',
        'export const runWarnCheck = runCheck;',
        'export const runToolCheck = runCheck;',
        'const _results = [];',
        'export function pushResult(name, status, elapsed) { _results.push({ name, status, elapsed }); }',
        'export function getResults() { return _results; }',
        'export function getFailed() { return _results.filter((r) => r.status === "FAIL").length; }',
        'export function setMode() {}',
        'export function setOrphanGuard() {}',
        'export function resolveTmpfsTmpdir() { return null; }',
        'export function gateFileState() { return "never-emitted"; }',
      ].join('\n'),
    )
    writeFileSync(
      join(scriptsDir, 'lib', 'gate-mutex.mjs'),
      'export const GATE_MUTEX_HELD_ENV = "ARBITER_GATE_MUTEX_HELD";\n' +
        'export const gateLockPathFor = () => { throw new Error("no repo"); };\n',
    )
    if (localFileSource !== null) {
      writeFileSync(join(scriptsDir, 'check-all.local.json'), localFileSource)
    }
    // The harness never reaches gate-evidence.mjs/arbiter.json — cut before
    // the marker/JSON-write tail, then force-exit right after the local slot.
    writeFileSync(
      join(scriptsDir, 'check-all.mjs'),
      prefix + '\nconsole.log("HARNESS_DONE:" + JSON.stringify(getResults()));\nprocess.exit(0);\n',
    )
    const _env = { ...process.env, NO_COLOR: '1' }
    delete _env.ARBITER_ALLOW_LOCAL_CHECKS
    const r = spawnSync(process.execPath, [join(scriptsDir, 'check-all.mjs'), ...args], {
      encoding: 'utf-8',
      cwd: dir,
      env: { ..._env, ...env },
    })
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function harnessResults(stdout: string): Array<{ name: string; status: string }> {
  return JSON.parse(/HARNESS_DONE:(\[.*\])/.exec(stdout)![1])
}

// #2679: proves the slot cannot execute an attacker-controlled command without
// explicit opt-in. Unlike runLocalSlotHarness (whose run-helpers stub only logs
// the call), this variant's runCheck really spawns cmd/args, so "did NOT run"
// is proven by a sentinel file's absence, not by an unexecuted log line.
function runLocalSlotHarnessReal(
  localFileSourceFor: (sentinelPath: string) => string,
  env: Record<string, string>,
): { status: number | null; stdout: string; sentinelExists: boolean } {
  const content = render()
  const cutIdx = content.indexOf('// ─── Summary')
  const prefix = content.slice(0, cutIdx)
  const dir = mkdtempSync(join(tmpdir(), 'arb-local-slot-real-'))
  const sentinelPath = join(dir, 'sentinel')
  try {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(join(scriptsDir, 'lib'), { recursive: true })
    writeFileSync(
      join(scriptsDir, 'lib', 'run-helpers.mjs'),
      [
        "import { spawnSync } from 'node:child_process';",
        'export function runCheck(name, cmd, args) {',
        '  const r = spawnSync(cmd, args, { encoding: "utf-8" });',
        '  pushResult(name, r.status === 0 ? "PASS" : "FAIL", 0);',
        '}',
        'export const runWarnCheck = runCheck;',
        'export const runToolCheck = runCheck;',
        'const _results = [];',
        'export function pushResult(name, status, elapsed) { _results.push({ name, status, elapsed }); }',
        'export function getResults() { return _results; }',
        'export function getFailed() { return _results.filter((r) => r.status === "FAIL").length; }',
        'export function setMode() {}',
        'export function setOrphanGuard() {}',
        'export function resolveTmpfsTmpdir() { return null; }',
        'export function gateFileState() { return "never-emitted"; }',
      ].join('\n'),
    )
    writeFileSync(
      join(scriptsDir, 'lib', 'gate-mutex.mjs'),
      'export const GATE_MUTEX_HELD_ENV = "ARBITER_GATE_MUTEX_HELD";\n' +
        'export const gateLockPathFor = () => { throw new Error("no repo"); };\n',
    )
    writeFileSync(join(scriptsDir, 'check-all.local.json'), localFileSourceFor(sentinelPath))
    writeFileSync(
      join(scriptsDir, 'check-all.mjs'),
      prefix + '\nconsole.log("HARNESS_DONE:" + JSON.stringify(getResults()));\nprocess.exit(0);\n',
    )
    const _env = { ...process.env, NO_COLOR: '1' }
    delete _env.ARBITER_ALLOW_LOCAL_CHECKS
    const r = spawnSync(process.execPath, [join(scriptsDir, 'check-all.mjs'), 'L2'], {
      encoding: 'utf-8',
      cwd: dir,
      env: { ..._env, ...env },
    })
    return { status: r.status, stdout: r.stdout ?? '', sentinelExists: existsSync(sentinelPath) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function sentinelJson(sentinelPath: string): string {
  return JSON.stringify({
    checks: [
      {
        name: 'poison',
        cmd: [
          process.execPath,
          '-e',
          `require('fs').writeFileSync(${JSON.stringify(sentinelPath)}, '1')`,
        ],
        tier: 'L1',
      },
    ],
  })
}

describe('check-all.mjs.ejs — local extension slot requires explicit opt-in (#2679)', () => {
  it('does NOT execute the local check and prints SKIP when no opt-in is given', () => {
    const r = runLocalSlotHarnessReal(sentinelJson, {})
    expect(r.status).toBe(0)
    expect(r.sentinelExists).toBe(false)
    expect(r.stdout).toContain(
      '[CHECK] local checks ... SKIP (scripts/check-all.local.json present but ' +
        'ARBITER_ALLOW_LOCAL_CHECKS is not set',
    )
  })

  it('executes the local check when ARBITER_ALLOW_LOCAL_CHECKS=1 is set', () => {
    const r = runLocalSlotHarnessReal(sentinelJson, { ARBITER_ALLOW_LOCAL_CHECKS: '1' })
    expect(r.status).toBe(0)
    expect(r.sentinelExists).toBe(true)
  })

  it('does not run under an unrecognized truthy env value ("true", not "1")', () => {
    const r = runLocalSlotHarnessReal(sentinelJson, { ARBITER_ALLOW_LOCAL_CHECKS: 'true' })
    expect(r.status).toBe(0)
    expect(r.sentinelExists).toBe(false)
  })
})

describe('check-all.mjs.ejs — --allow-local-checks CLI flag (#2679)', () => {
  it('executes the local check when --allow-local-checks is passed', () => {
    const content = render()
    const cutIdx = content.indexOf('// ─── Summary')
    const prefix = content.slice(0, cutIdx)
    const dir = mkdtempSync(join(tmpdir(), 'arb-local-slot-flag-'))
    const sentinelPath = join(dir, 'sentinel')
    try {
      const scriptsDir = join(dir, 'scripts')
      mkdirSync(join(scriptsDir, 'lib'), { recursive: true })
      writeFileSync(
        join(scriptsDir, 'lib', 'run-helpers.mjs'),
        [
          "import { spawnSync } from 'node:child_process';",
          'export function runCheck(name, cmd, args) {',
          '  const r = spawnSync(cmd, args, { encoding: "utf-8" });',
          '  pushResult(name, r.status === 0 ? "PASS" : "FAIL", 0);',
          '}',
          'export const runWarnCheck = runCheck;',
          'export const runToolCheck = runCheck;',
          'const _results = [];',
          'export function pushResult(name, status, elapsed) { _results.push({ name, status, elapsed }); }',
          'export function getResults() { return _results; }',
          'export function getFailed() { return _results.filter((r) => r.status === "FAIL").length; }',
          'export function setMode() {}',
          'export function setOrphanGuard() {}',
          'export function resolveTmpfsTmpdir() { return null; }',
          'export function gateFileState() { return "never-emitted"; }',
        ].join('\n'),
      )
      writeFileSync(
        join(scriptsDir, 'lib', 'gate-mutex.mjs'),
        'export const GATE_MUTEX_HELD_ENV = "ARBITER_GATE_MUTEX_HELD";\n' +
          'export const gateLockPathFor = () => { throw new Error("no repo"); };\n',
      )
      writeFileSync(join(scriptsDir, 'check-all.local.json'), sentinelJson(sentinelPath))
      writeFileSync(
        join(scriptsDir, 'check-all.mjs'),
        prefix +
          '\nconsole.log("HARNESS_DONE:" + JSON.stringify(getResults()));\nprocess.exit(0);\n',
      )
      const _env = { ...process.env, NO_COLOR: '1' }
      delete _env.ARBITER_ALLOW_LOCAL_CHECKS
      const r = spawnSync(
        process.execPath,
        [join(scriptsDir, 'check-all.mjs'), 'L2', '--allow-local-checks'],
        { encoding: 'utf-8', cwd: dir, env: _env },
      )
      expect(r.status).toBe(0)
      expect(existsSync(sentinelPath)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('check-all.mjs.ejs — local extension slot runtime behavior (#2666)', () => {
  // #2666 round 2: the mapping declares `local checks` WIRED on every pinned consumer,
  // but the old absent-file branch pushed no result at all — the name was emitted in
  // source, never executed, on any consumer without a check-all.local.json. A visible
  // SKIP keeps the name on the executed surface without claiming it can fail.
  it('pushes a visible SKIP for "local checks" when scripts/check-all.local.json is absent', () => {
    const r = runLocalSlotHarness(null)
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('[local]')
    const results = harnessResults(r.stdout)
    expect(results).toContainEqual({ name: 'local checks', status: 'SKIP', elapsed: 0 })
  })

  it('is a silent no-op when the file exists but declares no checks', () => {
    const r = runLocalSlotHarness('{}')
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('[local]')
    const results = harnessResults(r.stdout)
    expect(results.some((res) => res.status === 'FAIL')).toBe(false)
  })

  it('dispatches a declared local check through runCheck, labeled [local]', () => {
    const r = runLocalSlotHarness(
      JSON.stringify({
        checks: [
          {
            name: 'ripme java coverage',
            cmd: ['node', 'scripts/verify-module-coverage.mjs'],
            tier: 'L1',
          },
        ],
      }),
    )
    expect(r.status).toBe(0)
    const localLine = r.stdout
      .split('\n')
      .find((l) => l.startsWith('RUNCHECK:') && l.includes('[local]'))
    expect(localLine).toBeDefined()
    const call = JSON.parse(/RUNCHECK:(\{.*\})/.exec(localLine!)![1])
    expect(call.name).toBe('[local] ripme java coverage')
    expect(call.cmd).toBe('node')
    expect(call.args).toEqual(['scripts/verify-module-coverage.mjs'])
  })

  it('skips a local check whose declared tier is above the requested level', () => {
    const r = runLocalSlotHarness(
      JSON.stringify({ checks: [{ name: 'nightly-only', cmd: ['true'], tier: 'L3' }] }),
      ['L1'],
    )
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('[local] nightly-only')
  })

  it('fails loud on invalid JSON rather than silently skipping it', () => {
    const r = runLocalSlotHarness('{ not valid json')
    const results = harnessResults(r.stdout)
    expect(results.some((res) => res.status === 'FAIL')).toBe(true)
  })

  it('fails loud (never silently drops) a non-array "checks" field', () => {
    const r = runLocalSlotHarness(JSON.stringify({ checks: 'not-an-array' }))
    const results = harnessResults(r.stdout)
    expect(results.some((res) => res.status === 'FAIL')).toBe(true)
  })

  it('fails loud on a top-level array instead of an object', () => {
    const r = runLocalSlotHarness('[]')
    const results = harnessResults(r.stdout)
    expect(results.some((res) => res.status === 'FAIL')).toBe(true)
  })

  it('fails loud on a malformed entry (missing cmd) rather than silently skipping it', () => {
    const r = runLocalSlotHarness(JSON.stringify({ checks: [{ name: 'broken', tier: 'L1' }] }))
    const results = harnessResults(r.stdout)
    expect(results.some((res) => res.status === 'FAIL')).toBe(true)
  })

  it('fails loud on a malformed entry whose cmd contains an empty-string element', () => {
    const r = runLocalSlotHarness(
      JSON.stringify({ checks: [{ name: 'bad-cmd-empty', cmd: ['node', ''], tier: 'L1' }] }),
    )
    const results = harnessResults(r.stdout)
    expect(results.some((res) => res.status === 'FAIL')).toBe(true)
    expect(r.stdout).not.toContain('[local] bad-cmd-empty')
  })

  it('fails loud on a malformed entry whose cmd contains a non-string element', () => {
    const r = runLocalSlotHarness(
      JSON.stringify({ checks: [{ name: 'bad-cmd-type', cmd: ['node', 3], tier: 'L1' }] }),
    )
    const results = harnessResults(r.stdout)
    expect(results.some((res) => res.status === 'FAIL')).toBe(true)
    expect(r.stdout).not.toContain('[local] bad-cmd-type')
  })

  it('fails loud on an invalid tier value', () => {
    const r = runLocalSlotHarness(
      JSON.stringify({ checks: [{ name: 'bad-tier', cmd: ['true'], tier: 'nightly' }] }),
    )
    const results = harnessResults(r.stdout)
    expect(results.some((res) => res.status === 'FAIL')).toBe(true)
    expect(r.stdout).not.toContain('[local] bad-tier')
  })
})
