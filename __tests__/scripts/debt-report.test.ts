// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/debt-report.mjs')
const CAPTURE_SCRIPT = resolve('scripts/capture-debt-baseline.mjs')
const DEBT_LIB = resolve('scripts/debt-lib.mjs')
const GLOB_WALK = resolve('scripts/lib/glob-walk.mjs')

function run(cwd: string, args: string[] = []) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'debt-report-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('debt-report.mjs (gate: debt ratchet enforcement)', () => {
  it('requires a freshness token when reusing a gate coverage summary', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir, ['--gate', '--coverage-summary', 'coverage/coverage-summary.json'])
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('--coverage-summary requires --coverage-started-at')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when no baseline exists (grace period)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('debt-baseline.json not found')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when baseline version is not 2 (requires re-capture)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const scriptsDir = join(dir, 'scripts')
      mkdirSync(scriptsDir, { recursive: true })
      const baseline = {
        version: 1,
        capturedAt: '2026-01-01T00:00:00Z',
        commit: 'old',
        metrics: {},
      }
      writeFileSync(join(scriptsDir, 'debt-baseline.json'), JSON.stringify(baseline))
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('schema v1')
    } finally {
      cleanup()
    }
  })

  // NOTE: only the deterministic guard paths are tested here. Any case that
  // proceeds past the baseline guards invokes collectMetrics(cwd), which shells
  // out to real tools (eslint/tsc/jscpd) — slow (>20s, times out on a loaded CI
  // runner) and environment-dependent. Both cases above early-return before
  // collectMetrics, giving fast, deterministic coverage of the script's own
  // guard logic; the metric-comparison path is exercised by the real gate run.
})

describe('capture-debt-baseline.mjs (collection failures)', () => {
  it('fails closed and leaves no baseline when vitest ran without producing its summary (#2202)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const scriptsDir = join(dir, 'scripts')
      const binDir = join(dir, 'bin')
      mkdirSync(join(scriptsDir, 'lib'), { recursive: true })
      mkdirSync(join(dir, 'src'), { recursive: true })
      mkdirSync(binDir)
      copyFileSync(CAPTURE_SCRIPT, join(scriptsDir, 'capture-debt-baseline.mjs'))
      copyFileSync(DEBT_LIB, join(scriptsDir, 'debt-lib.mjs'))
      copyFileSync(GLOB_WALK, join(scriptsDir, 'lib', 'glob-walk.mjs'))
      writeFileSync(join(dir, 'src', 'fixture.ts'), 'export const fixture = 1\n')
      writeFileSync(
        join(dir, '.jscpd.json'),
        JSON.stringify({ path: ['src'], reporters: ['json'] }),
      )
      writeFileSync(
        join(binDir, 'npx'),
        `#!/bin/sh
case "$1" in
  vitest) exit 0 ;;
  eslint) printf '[]' ;;
  knip) printf '{}' ;;
esac
exit 0
`,
      )
      chmodSync(join(binDir, 'npx'), 0o755)

      const result = spawnSync('node', [join(scriptsDir, 'capture-debt-baseline.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('collection FAILURE for coverageLine')
      expect(existsSync(join(scriptsDir, 'debt-baseline.json'))).toBe(false)
    } finally {
      cleanup()
    }
  })

  it("does not read a stale .coverage-tmp/coverage-summary.json left by a previous run (stale-report poisoning, mirrors jscpd's guard)", () => {
    const { dir, cleanup } = makeTemp()
    try {
      const scriptsDir = join(dir, 'scripts')
      const binDir = join(dir, 'bin')
      mkdirSync(join(scriptsDir, 'lib'), { recursive: true })
      mkdirSync(join(dir, 'src'), { recursive: true })
      mkdirSync(join(dir, '.coverage-tmp'), { recursive: true })
      mkdirSync(binDir)
      copyFileSync(CAPTURE_SCRIPT, join(scriptsDir, 'capture-debt-baseline.mjs'))
      copyFileSync(DEBT_LIB, join(scriptsDir, 'debt-lib.mjs'))
      copyFileSync(GLOB_WALK, join(scriptsDir, 'lib', 'glob-walk.mjs'))
      writeFileSync(join(dir, 'src', 'fixture.ts'), 'export const fixture = 1\n')
      writeFileSync(
        join(dir, '.jscpd.json'),
        JSON.stringify({ path: ['src'], reporters: ['json'] }),
      )
      writeFileSync(
        join(dir, '.coverage-tmp', 'coverage-summary.json'),
        JSON.stringify({ total: { lines: { pct: 999 }, branches: { pct: 999 } } }),
      )
      writeFileSync(
        join(binDir, 'npx'),
        `#!/bin/sh
case "$1" in
  vitest) exit 0 ;;
  eslint) printf '[]' ;;
  knip) printf '{}' ;;
esac
exit 0
`,
      )
      chmodSync(join(binDir, 'npx'), 0o755)

      const result = spawnSync('node', [join(scriptsDir, 'capture-debt-baseline.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('collection FAILURE for coverageLine')
      expect(existsSync(join(scriptsDir, 'debt-baseline.json'))).toBe(false)
      expect(existsSync(join(dir, '.coverage-tmp', 'coverage-summary.json'))).toBe(false)
    } finally {
      cleanup()
    }
  })
})

// ─── jscpdScan (#1286 — jscpd v5 fail-closed fileset contract) ────────────────
// jscpd v5 silently ignores config `pattern`/`path` and exits 0 on a 0-file
// scan, writing a 0% report. jscpdScan is the single fail-closed entrypoint:
// fileset comes from `.jscpd.json#path` (script-private SSOT) passed as
// positional args; a scan that ran but covered 0 sources is an ERROR, never a
// recorded 0%. Spawn is injectable so these tests never shell to real jscpd.
describe('jscpdScan (jscpd v5 fail-closed scan helper)', () => {
  async function load() {
    return await import('../../scripts/debt-lib.mjs')
  }

  function writeConfig(dir: string, cfg: Record<string, unknown>) {
    writeFileSync(join(dir, '.jscpd.json'), JSON.stringify(cfg))
  }

  const okSpawn = (report: Record<string, unknown>, status = 0) => {
    return (cwd: string) => {
      mkdirSync(join(cwd, 'report'), { recursive: true })
      writeFileSync(join(cwd, 'report', 'jscpd-report.json'), JSON.stringify(report))
      return { status, stdout: '', stderr: '' }
    }
  }

  it('errors when .jscpd.json is missing (fail-closed, no spawn)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      const res = jscpdScan(dir, {
        spawn: () => {
          throw new Error('must not spawn')
        },
      })
      expect(res.error).toBeTruthy()
    } finally {
      cleanup()
    }
  })

  it('errors with a migration message on legacy v4 config (`pattern`, no `path`)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { pattern: 'src/**/*.ts', reporters: ['json'] })
      const res = jscpdScan(dir, {
        spawn: () => {
          throw new Error('must not spawn')
        },
      })
      expect(res.error).toMatch(/path/)
      expect(res.error).toMatch(/pattern/)
    } finally {
      cleanup()
    }
  })

  it('passes config paths as positional args with --no-install', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src', 'scripts'], reporters: ['json'] })
      let seenArgs: string[] = []
      jscpdScan(dir, {
        spawn: (_cwd: string, args: string[]) => {
          seenArgs = args
          return okSpawn({ statistics: { total: { sources: 10, percentage: 1.0 } } })(dir)
        },
      })
      expect(seenArgs).toContain('--no-install')
      expect(seenArgs).toContain('src')
      expect(seenArgs).toContain('scripts')
    } finally {
      cleanup()
    }
  })

  it('removes a stale report before spawning (no stale-report poisoning)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src'], reporters: ['json'] })
      mkdirSync(join(dir, 'report'), { recursive: true })
      writeFileSync(
        join(dir, 'report', 'jscpd-report.json'),
        JSON.stringify({ statistics: { total: { sources: 999, percentage: 9.9 } } }),
      )
      // spawn fails AND writes no report — the stale 999-source report must not be parsed
      const res = jscpdScan(dir, {
        spawn: () => ({ status: 2, stdout: '', stderr: 'boom' }),
      })
      expect(res.error).toBeTruthy()
      expect(res.sources).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('skips (like a missing tool) when npx cancels because jscpd is not installed', async () => {
    // Greenfield targets legitimately lack jscpd: `npx --no-install jscpd` exits 1
    // with "npx canceled due to missing packages" instead of ENOENT. That is the
    // tool-not-installed case (spawnOrSkip contract), not a failed scan — init must
    // skip the collector, not fail closed (#1286 regression).
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src'], reporters: ['json'] })
      const res = jscpdScan(dir, {
        spawn: () => ({
          status: 1,
          stdout: '',
          stderr:
            'npm error npx canceled due to missing packages and no YES option: ["jscpd@5.0.7"]',
        }),
      })
      expect(res.skipped).toBe(true)
      expect(res.error).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('treats a 0-source scan as an ERROR, never a 0% value (fail-closed, CANON-22)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src'], reporters: ['json'] })
      const res = jscpdScan(dir, {
        spawn: okSpawn({ statistics: { total: { sources: 0, percentage: 0 } } }),
      })
      expect(res.error).toBeTruthy()
    } finally {
      cleanup()
    }
  })

  it('returns sources + percentage on a healthy scan', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src'], reporters: ['json'] })
      const res = jscpdScan(dir, {
        spawn: okSpawn({ statistics: { total: { sources: 458, percentage: 1.39 } } }),
      })
      expect(res.error).toBeUndefined()
      expect(res.sources).toBe(458)
      expect(res.percentage).toBeCloseTo(1.39)
    } finally {
      cleanup()
    }
  })

  it('passes a threshold breach through (exit 1 + valid report ≠ error)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src'], reporters: ['json'] })
      const res = jscpdScan(dir, {
        spawn: okSpawn({ statistics: { total: { sources: 100, percentage: 7.2 } } }, 1),
      })
      expect(res.error).toBeUndefined()
      expect(res.status).toBe(1)
      expect(res.sources).toBe(100)
      expect(res.percentage).toBeCloseTo(7.2)
    } finally {
      cleanup()
    }
  })

  it('errors when reporters lack "json" (exit-0-no-report would be unclassifiable)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src'], reporters: ['consoleFull'] })
      const res = jscpdScan(dir, {
        spawn: () => {
          throw new Error('must not spawn')
        },
      })
      expect(res.error).toMatch(/json/)
    } finally {
      cleanup()
    }
  })

  it('honors a custom `output` dir for the report (no false legacyNoReport)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src'], reporters: ['json'], output: 'custom-out' })
      const res = jscpdScan(dir, {
        spawn: (cwd: string) => {
          mkdirSync(join(cwd, 'custom-out'), { recursive: true })
          writeFileSync(
            join(cwd, 'custom-out', 'jscpd-report.json'),
            JSON.stringify({ statistics: { total: { sources: 42, percentage: 2.5 } } }),
          )
          return { status: 0, stdout: '', stderr: '' }
        },
      })
      expect(res.error).toBeUndefined()
      expect(res.sources).toBe(42)
    } finally {
      cleanup()
    }
  })

  it('errors on report-schema drift (sources > 0 but no numeric percentage)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src'], reporters: ['json'] })
      const res = jscpdScan(dir, {
        spawn: okSpawn({ statistics: { total: { sources: 100 } } }),
      })
      expect(res.error).toMatch(/percentage/)
    } finally {
      cleanup()
    }
  })

  it('flags v4-binary semantics (exit 0, no report) as legacyNoReport', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { jscpdScan } = await load()
      writeConfig(dir, { path: ['src'], reporters: ['json'] })
      const res = jscpdScan(dir, {
        spawn: () => ({ status: 0, stdout: '', stderr: '' }),
      })
      expect(res.legacyNoReport).toBe(true)
      expect(res.error).toBeUndefined()
    } finally {
      cleanup()
    }
  })
})

// ─── resolveJscpdSpawn (#1304 — glibc-resilient default spawn) ───────────────
// jscpd v5 runs a prebuilt native `cpd` binary chosen per platform. On the
// docker-ci-build runner the glibc `cpd-linux-x64-gnu` binary is built against
// GLIBC ≥ 2.34 but the image's glibc is < 2.32, so the loader rejects it: exit 1,
// no report, fail-closed — even though jscpd "is installed". resolveJscpdSpawn
// runs the resolved binary directly and, on that glibc-too-old failure, retries
// once with the static (musl, libc-independent) `cpd` so the scan actually runs.
describe('resolveJscpdSpawn (#1304 glibc-resilient spawn)', () => {
  async function load() {
    return await import('../../scripts/debt-lib.mjs')
  }

  it('is exported and returns a spawn function', async () => {
    const { resolveJscpdSpawn } = await load()
    expect(typeof resolveJscpdSpawn).toBe('function')
    const spawn = resolveJscpdSpawn(resolve('.'))
    expect(typeof spawn).toBe('function')
  })

  it('detects the glibc-too-old failure signature', async () => {
    const { isGlibcIncompatible } = await load()
    expect(
      isGlibcIncompatible({
        status: 1,
        stderr: "cpd: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34' not found",
      }),
    ).toBe(true)
    // A clean run, a threshold breach, and an unrelated error are NOT glibc.
    expect(isGlibcIncompatible({ status: 0, stderr: '' })).toBe(false)
    expect(isGlibcIncompatible({ status: 1, stderr: 'Found 3 clones' })).toBe(false)
  })

  // #2370: jscpd renamed its musl platform package `cpd-linux-x64-musl` ->
  // `jscpd-linux-x64-musl` in 5.0.16, which silently broke the hardcoded
  // constant this used to be. Derive it from jscpd's own optionalDependencies
  // instead so a future rename can't repeat the breakage.
  it('derives the musl platform package name from jscpd optionalDependencies', async () => {
    const { deriveStaticMuslPkgName } = await load()
    expect(
      deriveStaticMuslPkgName({
        optionalDependencies: {
          'jscpd-linux-x64-gnu': '5.0.16',
          'jscpd-linux-x64-musl': '5.0.16',
          'jscpd-darwin-arm64': '5.0.16',
        },
      }),
    ).toBe('jscpd-linux-x64-musl')
    // Pre-#2370 naming still resolves — the derivation is name-agnostic.
    expect(
      deriveStaticMuslPkgName({ optionalDependencies: { 'cpd-linux-x64-musl': '5.0.11' } }),
    ).toBe('cpd-linux-x64-musl')
    // No musl key, or no optionalDependencies at all: null, never a guess.
    expect(
      deriveStaticMuslPkgName({ optionalDependencies: { 'jscpd-linux-x64-gnu': '5.0.16' } }),
    ).toBeNull()
    expect(deriveStaticMuslPkgName({})).toBeNull()
  })

  it('retries the static cpd binary when the native binary is glibc-incompatible', async () => {
    const { resolveJscpdSpawn } = await load()
    const calls: string[] = []
    const spawn = resolveJscpdSpawn(resolve('.'), {
      // Skip real jscpd resolution; the static path is what we exercise.
      resolveBin: () => '/fake/node_modules/jscpd/run-jscpd.js',
      resolveStatic: () => '/fake/.cache/jscpd-static/5.0.6/cpd',
    })
    const r = spawn(resolve('.'), ['--no-install', 'jscpd', 'src', '--silent'], {
      spawnFn: (cmd: string) => {
        calls.push(cmd)
        // First call (the native launcher via node) reports the glibc failure;
        // the retried static binary succeeds.
        return cmd.endsWith('/cpd')
          ? { status: 0, stdout: 'ok', stderr: '' }
          : { status: 1, stdout: '', stderr: "version `GLIBC_2.34' not found" }
      },
    })
    expect(r.status).toBe(0)
    expect(calls.length).toBe(2)
    expect(calls[1]).toBe('/fake/.cache/jscpd-static/5.0.6/cpd')
  })

  it('keeps the original failure (fail-closed) when no static binary is available', async () => {
    const { resolveJscpdSpawn } = await load()
    const spawn = resolveJscpdSpawn(resolve('.'), {
      resolveBin: () => '/fake/node_modules/jscpd/run-jscpd.js',
      resolveStatic: () => null,
    })
    const r = spawn(resolve('.'), ['--no-install', 'jscpd', 'src', '--silent'], {
      spawnFn: () => ({ status: 1, stdout: '', stderr: "version `GLIBC_2.34' not found" }),
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/GLIBC/)
  })

  it('falls back to a skip-spawn when jscpd cannot be resolved (greenfield)', async () => {
    // Resolution from a cwd with no jscpd reachable must NOT throw — it must
    // return the npx --no-install fallback whose null/missing-packages result
    // makes jscpdScan return {skipped:true} (tool-not-installed contract).
    const { dir, cleanup } = makeTemp()
    try {
      const { resolveJscpdSpawn } = await load()
      const spawn = resolveJscpdSpawn(dir, {
        resolveBin: () => {
          throw new Error('Cannot find module jscpd')
        },
      })
      expect(typeof spawn).toBe('function')
      // The fallback npx spawn is injected with a stub that mimics the
      // missing-packages exit so we never shell to a real npx.
      const r = spawn(dir, ['--no-install', 'jscpd', 'src', '--silent'], {
        spawnFn: () => ({
          status: 1,
          stdout: '',
          stderr: 'npm error npx canceled due to missing packages and no YES option',
        }),
      })
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/missing packages/)
    } finally {
      cleanup()
    }
  })
})

// ─── assertKeyParity (#1286 — baseline recapture must never drop metrics) ────
describe('assertKeyParity (baseline key-drop guard)', () => {
  it('throws when a previously-present metric key would be dropped', async () => {
    const { assertKeyParity } = await import('../../scripts/debt-lib.mjs')
    expect(() =>
      assertKeyParity(
        { duplicationPercentage: { value: 1.36 }, deadCode: { value: 0 } },
        { deadCode: { value: 0 } },
      ),
    ).toThrow(/duplicationPercentage/)
  })

  it('passes when key sets are preserved (new keys allowed)', async () => {
    const { assertKeyParity } = await import('../../scripts/debt-lib.mjs')
    expect(() =>
      assertKeyParity(
        { deadCode: { value: 0 } },
        { deadCode: { value: 0 }, duplicationPercentage: { value: 1.39 } },
      ),
    ).not.toThrow()
  })
})

// ─── self .jscpd.json fileset (#1286) ─────────────────────────────────────────
describe('self .jscpd.json (jscpd v5 fileset SSOT)', () => {
  it('carries the v5 path/format fileset and no v4 pattern', () => {
    const cfg = JSON.parse(readFileSync(resolve('.jscpd.json'), 'utf-8'))
    expect(cfg.pattern).toBeUndefined()
    expect(cfg.path).toEqual(['src', 'scripts', '.claude/hooks'])
    expect(cfg.format).toContain('typescript')
    expect(cfg.format).toContain('javascript')
    expect(cfg.ignore).toContain('__tests__/fixtures/**')
    expect(cfg.ignore).toContain('src/templates/**')
  })
})

// ─── check-duplication.mjs (#1286 — hard fail-closed duplication gate) ───────
describe('check-duplication.mjs (fail-closed duplication gate)', () => {
  const GATE = resolve('scripts/check-duplication.mjs')

  function runGate(cwd: string) {
    const r = spawnSync('node', [GATE], { encoding: 'utf-8', cwd })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  it('exits 1 when .jscpd.json is missing (fail-closed)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = runGate(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('exits 1 with a migration hint on a legacy v4 config (pattern, no path)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeFileSync(join(dir, '.jscpd.json'), JSON.stringify({ pattern: 'src/**/*.ts' }))
      const result = runGate(dir)
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/path/)
    } finally {
      cleanup()
    }
  })

  // Fake-jscpd shim (#1304): the gate now resolves the locally-installed jscpd
  // binary directly (no npx). We plant a fake `node_modules/jscpd` package in the
  // temp cwd — resolveJscpdSpawn finds it first — whose bin writes a crafted
  // report and exits with the given status, exercising the post-spawn gate
  // branches without live jscpd.
  function installJscpdShim(dir: string, report: Record<string, unknown>, exitCode: number) {
    const pkgDir = join(dir, 'node_modules', 'jscpd')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'jscpd', version: '5.0.6', bin: { jscpd: './run.js' } }),
    )
    writeFileSync(
      join(pkgDir, 'run.js'),
      [
        `const { mkdirSync, writeFileSync } = require('fs')`,
        `mkdirSync('report', { recursive: true })`,
        `writeFileSync('report/jscpd-report.json', ${JSON.stringify(JSON.stringify(report))})`,
        `process.exit(${exitCode})`,
      ].join('\n'),
    )
  }

  function runGateInDir(cwd: string) {
    const r = spawnSync('node', [GATE], { encoding: 'utf-8', cwd })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  it('exits 1 on threshold breach (jscpd exit 1 with a valid report)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeFileSync(
        join(dir, '.jscpd.json'),
        JSON.stringify({ path: ['src'], reporters: ['json'] }),
      )
      installJscpdShim(dir, { statistics: { total: { sources: 100, percentage: 7.2 } } }, 1)
      const result = runGateInDir(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toMatch(/over threshold/)
    } finally {
      cleanup()
    }
  })

  it('exits 0 with an OK line on a healthy under-threshold scan', () => {
    const { dir, cleanup } = makeTemp()
    try {
      writeFileSync(
        join(dir, '.jscpd.json'),
        JSON.stringify({ path: ['src'], reporters: ['json'] }),
      )
      installJscpdShim(dir, { statistics: { total: { sources: 459, percentage: 1.39 } } }, 0)
      const result = runGateInDir(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/\[duplication\] OK/)
    } finally {
      cleanup()
    }
  })
})

// ─── debt-report --gate hard-fail on collection errors (#1286) ───────────────
describe('debt-report.mjs --gate (fail-closed on collection errors)', () => {
  function setupTempProject(dir: string) {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    writeFileSync(
      join(scriptsDir, 'debt-baseline.json'),
      JSON.stringify({
        version: 2,
        capturedAt: '2026-01-01T00:00:00Z',
        commit: 'abc1234',
        archetype: 'library',
        metrics: {
          duplicationPercentage: { value: 1.36, unit: 'percent', direction: 'lower-is-better' },
        },
      }),
    )
    // Legacy v4 jscpd config: jscpdScan errors BEFORE any spawn → deterministic
    // collection failure without live tools.
    writeFileSync(join(dir, '.jscpd.json'), JSON.stringify({ pattern: 'src/**/*.ts' }))
    // Fast no-op npx shim so the other collectMetrics tools (vitest/eslint/
    // tsc/knip) fail instantly instead of fetching/running for real.
    const binDir = join(dir, 'fake-bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'npx'), '#!/bin/sh\nexit 1\n')
    spawnSync('chmod', ['+x', join(binDir, 'npx')])
    return binDir
  }

  function runReport(cwd: string, binDir: string, args: string[]) {
    const r = spawnSync('node', [SCRIPT, ...args], {
      encoding: 'utf-8',
      cwd,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  it('exits 1 in --gate mode when jscpd ran but collection failed (config drift)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const binDir = setupTempProject(dir)
      const result = runReport(dir, binDir, ['--gate'])
      expect(result.status).toBe(1)
      expect(result.stdout).toMatch(/collection FAILURE for duplicationPercentage/)
    } finally {
      cleanup()
    }
  })

  it('exits 0 without --gate (report-only mode warns, never fails)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const binDir = setupTempProject(dir)
      const result = runReport(dir, binDir, [])
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/collection FAILURE/)
    } finally {
      cleanup()
    }
  })
})

// ─── coverage noise-tolerance boundary (#2253) ────────────────────────────────
// CI's v8 coverage collector measures ~0.2pp lower than a locally-captured
// baseline on identical code (platform/timing variance, not a real
// regression) — observed on wave-3: coverageLine -0.16pp, coverageBranch
// -0.22pp both false-flagged "regressed" against a locally-captured baseline.
// coverageLine/coverageBranch tolerate up to 0.4pp of drop (matching
// check-coverage-ratchet.mjs's own TOLERANCE for the identical v8-jitter
// reason) before it counts as a regression.
describe('debt-report.mjs coverage noise tolerance (#2253)', () => {
  const BASE_LINE = 90
  const BASE_BRANCH = 85

  function setupTempProject(dir: string) {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    writeFileSync(
      join(scriptsDir, 'debt-baseline.json'),
      JSON.stringify({
        version: 2,
        capturedAt: '2026-01-01T00:00:00Z',
        commit: 'abc1234',
        archetype: 'library',
        metrics: {
          coverageLine: { value: BASE_LINE, unit: 'percent', direction: 'higher-is-better' },
          coverageBranch: { value: BASE_BRANCH, unit: 'percent', direction: 'higher-is-better' },
        },
      }),
    )
    writeFileSync(join(dir, '.jscpd.json'), JSON.stringify({ path: ['src'], reporters: ['json'] }))
    // Fake node_modules/jscpd: resolveJscpdSpawn resolves this BEFORE falling
    // back to the real repo's jscpd (via import.meta.url) since debt-report.mjs
    // is spawned from its real location — without this shim the scan would
    // shell to the actual installed jscpd. Exits 0, writes no report: the
    // legacyNoReport contract (0% duplication), zero collectionErrors.
    const jscpdDir = join(dir, 'node_modules', 'jscpd')
    mkdirSync(jscpdDir, { recursive: true })
    writeFileSync(
      join(jscpdDir, 'package.json'),
      JSON.stringify({ name: 'jscpd', version: '5.0.6', bin: { jscpd: './run.js' } }),
    )
    writeFileSync(join(jscpdDir, 'run.js'), 'process.exit(0)\n')

    // npx shim: vitest writes a crafted coverage summary (pct values driven by
    // env vars so each test case supplies its own current coverage); eslint/knip
    // return empty reports; tsc/anything else falls through to a clean exit 0.
    const binDir = join(dir, 'fake-bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(
      join(binDir, 'npx'),
      `#!/bin/sh
case "$1" in
  vitest)
    mkdir -p .coverage-tmp
    cat > .coverage-tmp/coverage-summary.json <<JSON
{"total":{"lines":{"pct":$CURR_LINE_PCT},"branches":{"pct":$CURR_BRANCH_PCT}}}
JSON
    exit 0 ;;
  eslint) printf '[]' ;;
  knip) printf '{}' ;;
esac
exit 0
`,
    )
    chmodSync(join(binDir, 'npx'), 0o755)
    return binDir
  }

  function runReport(dir: string, binDir: string, currLine: number, currBranch: number) {
    const r = spawnSync('node', [SCRIPT, '--gate'], {
      encoding: 'utf-8',
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        CURR_LINE_PCT: String(currLine),
        CURR_BRANCH_PCT: String(currBranch),
      },
    })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  it('passes a 0.4pp coverage drop (within the noise floor)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const binDir = setupTempProject(dir)
      const result = runReport(dir, binDir, BASE_LINE - 0.4, BASE_BRANCH - 0.4)
      expect(result.stdout).not.toMatch(/collection FAILURE/)
      expect(result.stdout).not.toMatch(/coverageLine.*regressed/)
      expect(result.stdout).not.toMatch(/coverageBranch.*regressed/)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('fails a 0.6pp coverage drop (past the noise floor — a real regression)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const binDir = setupTempProject(dir)
      const result = runReport(dir, binDir, BASE_LINE - 0.6, BASE_BRANCH - 0.6)
      expect(result.stdout).not.toMatch(/collection FAILURE/)
      expect(result.stdout).toMatch(/coverageLine.*regressed/)
      expect(result.stdout).toMatch(/coverageBranch.*regressed/)
      expect(result.stderr).toMatch(/GATE FAIL: 2 metric\(s\) regressed/)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })
})
