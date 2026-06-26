// SPDX-License-Identifier: Apache-2.0
// #1504 (B1) — the gate-arg compatibility fake-green.
//
// The generated PR/nightly workflows invoke the gate as
// `node scripts/check-all.mjs L2 --json <path>`. A check-all that misreads the
// level (e.g. a positional parser fed `--level L2` reads "--level" as the level)
// silently degrades L2→L1 while the job stays GREEN — the exact fake-green the
// anti-fake-green wave exists to kill.
//
// This suite proves three things about the rendered output:
//   1. the emitted workflow invocation is POSITIONAL (`check-all.mjs L2 --json`),
//      so even a naive `process.argv[2]` parser reads the level correctly;
//   2. the rendered check-all arg parser is ROBUST (positional + subcommand +
//      `--level` + `--json`) AND FAILS LOUD (exit 2) on a garbage/missing level
//      instead of silently degrading;
//   3. the parser is executed in isolation (red→green), not merely string-matched.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderCheckAll(overrides: Record<string, unknown> = {}): string {
  return renderTemplate(
    'scripts/check-all.mjs.ejs',
    makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
      enableDebtGates: true,
      coverageEnabled: true,
      coverageThreshold: 80,
      mutationEnabled: false,
      mutationThreshold: 85,
      ...overrides,
    }) as unknown as Record<string, unknown>,
  )
}

/**
 * Extract the self-contained ARG-PARSE block from the rendered gate and run it in
 * a throwaway node process that prints the resolved {level, jsonPath}. The block
 * imports nothing, so it executes standalone — letting us assert real exit codes.
 */
function runParser(args: string[]): { code: number; stdout: string; stderr: string } {
  const rendered = renderCheckAll()
  const start = rendered.indexOf('// >>> ARG-PARSE-START')
  const end = rendered.indexOf('// <<< ARG-PARSE-END')
  if (start === -1 || end === -1) throw new Error('ARG-PARSE markers not found in rendered gate')
  const block = rendered.slice(start, end)
  const harness = `${block}\nprocess.stdout.write(JSON.stringify({ level, jsonPath }));\n`
  const dir = mkdtempSync(join(tmpdir(), 'gate-arg-'))
  const file = join(dir, 'parse-only.mjs')
  writeFileSync(file, harness)
  try {
    const stdout = execFileSync('node', [file, ...args], { encoding: 'utf-8' })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string }
    return {
      code: err.status ?? 1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? ''),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('check-all.mjs.ejs — robust, fail-loud gate-arg parsing (#1504)', () => {
  it('resolves the positional level form `L2 --json <path>` (what the workflow emits)', () => {
    const r = runParser(['L2', '--json', 'gate-result.json'])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ level: 'L2', jsonPath: 'gate-result.json' })
  })

  it('resolves the flag form `--level L2 --json <path>`', () => {
    const r = runParser(['--level', 'L2', '--json', 'gate-result.json'])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ level: 'L2', jsonPath: 'gate-result.json' })
  })

  it('resolves the `--level=L2` glued form', () => {
    const r = runParser(['--level=L3'])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout).level).toBe('L3')
  })

  it('maps subcommand aliases used by the Makefile + git hooks', () => {
    expect(JSON.parse(runParser(['check']).stdout).level).toBe('L1')
    expect(JSON.parse(runParser(['gate']).stdout).level).toBe('L2')
    expect(
      JSON.parse(runParser(['gate', '--json', '.arbiter/gate/local-result.json']).stdout),
    ).toEqual({ level: 'L2', jsonPath: '.arbiter/gate/local-result.json' })
    expect(JSON.parse(runParser(['full']).stdout).level).toBe('L2')
    expect(JSON.parse(runParser(['simulate-nightly']).stdout).level).toBe('L2')
  })

  it('defaults to L2 with no args', () => {
    expect(JSON.parse(runParser([]).stdout).level).toBe('L2')
  })

  // ── FAIL LOUD — the anti-fake-green core. Each garbage form must exit non-zero
  //    BEFORE any check runs, never silently degrade to a weaker level. ──────────
  it('FAILS LOUD (exit 2) on a bare garbage level token', () => {
    const r = runParser(['zzgarbage'])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('FATAL')
  })

  it('FAILS LOUD (exit 2) when `--level` is given the literal next flag as its value', () => {
    // The classic fake-green: `--level` consumed as a flag, `--json` is not a level.
    const r = runParser(['--level', '--json', 'x.json'])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('--level')
  })

  it('FAILS LOUD (exit 2) on `--level BOGUS`', () => {
    const r = runParser(['--level', 'BOGUS'])
    expect(r.code).toBe(2)
  })

  it('FAILS LOUD (exit 2) when `--level` is the trailing arg (missing value)', () => {
    const r = runParser(['--level'])
    expect(r.code).toBe(2)
  })
})

describe('generated gate invocation is arg-compatible (#1504)', () => {
  const CI_CTX = makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
    enableDebtGates: true,
    coverageEnabled: true,
    coverageThreshold: 80,
    mutationEnabled: false,
    mutationThreshold: 85,
  }) as unknown as Record<string, unknown>

  it('01-pr-fast emits the POSITIONAL level form (level token precedes --json)', () => {
    const wf = renderTemplate('github/workflows/01-pr-fast.yml.ejs', CI_CTX)
    expect(wf).toContain('node scripts/check-all.mjs L2 --json gate-result.json')
    // A level token consumed positionally as argv[2] must be a real level, never
    // the literal "--level" — that is the form a naive positional parser misreads.
    expect(wf).not.toContain('check-all.mjs --level L2')
  })

  it('06-nightly emits the POSITIONAL level form', () => {
    const wf = renderTemplate('github/workflows/06-nightly.yml.ejs', CI_CTX)
    expect(wf).toContain('node scripts/check-all.mjs L2 --json gate-result-nightly.json')
    expect(wf).not.toContain('check-all.mjs --level L2')
  })
})
