// SPDX-License-Identifier: Apache-2.0
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { measure } from '../utils/perf.js'
import { jsonOutput } from '../utils/json-output.js'
import { runCli } from '../utils/run-cli.js'

export interface BenchmarkHooksOptions {
  dir?: string
  iterations?: number
  json?: boolean
  baselineFile?: string
}

export interface HookTiming {
  hook: string
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  samples: number
}

export interface BenchmarkResult {
  hooks: HookTiming[]
  totalP95Ms: number
  regressions: string[]
}

const FIXTURE_STDIN = JSON.stringify({ tool: 'Bash', input: { command: 'echo hello' } })

function runHookOnce(hookPath: string): void {
  try {
    runCli(process.execPath, [hookPath], {
      input: FIXTURE_STDIN,
      timeoutMs: 5_000,
      env: { ...process.env, ARBITER_PLAN_BYPASS: '1' },
    })
  } catch {
    // hook exit code is irrelevant — we measure wall time only
  }
}

function loadBaseline(baselineFile: string): Record<string, unknown> | null {
  if (!existsSync(baselineFile)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(baselineFile, 'utf-8'))
  } catch (err) {
    process.stderr.write(
      `Warning: baseline file exists but contains invalid JSON (${baselineFile}): ${String(err)}\n` +
        `Regression detection disabled. Delete or regenerate the baseline.\n`,
    )
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    process.stderr.write(
      `Warning: baseline file has unexpected structure (${baselineFile}). ` +
        `Expected object, got ${Array.isArray(raw) ? 'array' : typeof raw}.\n` +
        `Regression detection disabled. Delete or regenerate the baseline.\n`,
    )
    return null
  }
  return raw as Record<string, unknown>
}

function printHumanResults(
  result: BenchmarkResult,
  iterations: number,
  baselineFile: string,
  baseline: Record<string, unknown> | null,
): void {
  process.stdout.write(`Hook Latency Benchmark (${iterations} iterations each)\n\n`)
  process.stdout.write(
    `${'Hook'.padEnd(40)} ${'p50'.padStart(8)} ${'p95'.padStart(8)} ${'p99'.padStart(8)}\n`,
  )
  process.stdout.write(`${'-'.repeat(70)}\n`)
  for (const h of result.hooks) {
    const regression = result.regressions.some((r) => r.startsWith(h.hook)) ? ' ⚠' : ''
    process.stdout.write(
      `${h.hook.padEnd(40)} ${`${h.p50}ms`.padStart(8)} ${`${h.p95}ms`.padStart(8)} ${`${h.p99}ms`.padStart(8)}${regression}\n`,
    )
  }
  process.stdout.write(`\nTotal p95 (sum): ${result.totalP95Ms.toFixed(1)}ms\n`)
  if (!baseline) {
    process.stdout.write(
      `\nNo baseline found at ${baselineFile}.\n` +
        `To set a baseline: arbiter benchmark hooks --json > ${baselineFile}\n`,
    )
  } else if (result.regressions.length > 0) {
    process.stdout.write(`\nRegressions (>20% vs baseline):\n`)
    for (const r of result.regressions) process.stdout.write(`  ${r}\n`)
  }
}

function checkRegression(
  hookFile: string,
  timing: { p95: number },
  baseline: Record<string, unknown> | null,
  regressions: string[],
): void {
  if (!baseline) return
  const baseP95 = baseline[hookFile]
  if (typeof baseP95 === 'number' && timing.p95 > baseP95 * 1.2) {
    regressions.push(
      `${hookFile}: p95 ${timing.p95}ms vs baseline ${baseP95}ms (+${Math.round(((timing.p95 - baseP95) / baseP95) * 100)}%)`,
    )
  }
}

export function runBenchmarkHooks(opts: BenchmarkHooksOptions = {}): BenchmarkResult {
  const dir = resolve(opts.dir ?? process.cwd())
  const hooksDir = join(dir, '.claude', 'hooks')
  const iterations = opts.iterations ?? 20
  const baselineFile =
    opts.baselineFile ?? join(dir, '.arbiter', 'benchmarks', 'hooks-baseline.json')

  if (!existsSync(hooksDir)) {
    throw new Error(`No hooks directory found at ${hooksDir}. Run arbiter init first.`)
  }

  const hookFiles = readdirSync(hooksDir)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('lib'))
    .sort()

  const baseline = loadBaseline(baselineFile)
  const hookResults: HookTiming[] = []
  const regressions: string[] = []

  for (const hookFile of hookFiles) {
    const hookPath = join(hooksDir, hookFile)
    const timing = measure(() => {
      runHookOnce(hookPath)
    }, iterations)
    hookResults.push({ hook: hookFile, ...timing })
    checkRegression(hookFile, timing, baseline, regressions)
  }

  const totalP95Ms = hookResults.reduce((sum, h) => sum + h.p95, 0)
  const result: BenchmarkResult = { hooks: hookResults, totalP95Ms, regressions }

  if (opts.json) {
    jsonOutput('benchmark hooks', 'ok', result as unknown as Record<string, unknown>, [])
  } else {
    printHumanResults(result, iterations, baselineFile, baseline)
  }

  return result
}
