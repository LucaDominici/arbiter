// SPDX-License-Identifier: Apache-2.0
//
// Skill/command regression-eval harness (#1264).
//
// Evaluates the observable BEHAVIOR of arbiter's own skills/commands across
// fixed scenario fixtures (input → expected outcome), scores pass/fail with
// variance analysis (pass-rate + outcome-stability + timing percentiles), and
// emits machine-readable + human-readable + HTML reports. Goal: detect
// regressions in skill/command behavior across model upgrades (ADR-088 trigger).
//
// Scope: this is a DEV-ONLY self-command (`arbiter skill-eval`). It is NOT a gate
// wired into scripts/check-all.mjs and NOT generated into target projects, so it
// carries no CANON-01/14 dual-sided template + dogfood burden and no 5×4×3
// matrix-testing invariant (that applies to generated content only).
//
// The three named scenarios (gate-failure, standard-completion, docs-only-pr) are
// RUNTIME outcomes, so a scenario declares a real deterministic CLI invocation
// and expected-outcome assertions. A future LLM-judge backend is left as a
// documented `backend` seam (`cli` now; `llm` deferred — not wired).
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'
import { jsonOutput } from '../utils/json-output.js'
import { readBaselineFileSafe } from '../utils/safe-read.js'
import { hasNestedUnboundedQuantifier } from '../conformance/shared.js'

/** How a scenario is executed. Only `cli` is wired; `llm` is a deferred seam. */
type ScenarioBackend = 'cli' | 'llm'

/** Expected-outcome assertions for a single scenario. */
interface ScenarioExpectation {
  /** Expected process exit code. */
  exitCode?: number
  /** Substring or regex source that stdout must match. */
  stdoutMatches?: string
  /** Substring or regex source that stderr must match. */
  stderrMatches?: string
  /** Equality checks against fields of the parsed-JSON stdout envelope. */
  jsonEnvelope?: Record<string, string | number | boolean>
}

/** A behavioral scenario fixture: input situation → expected observable outcome. */
export interface Scenario {
  /** Stable scenario id, also the fixture filename stem. */
  name: string
  /** Which skill/command this scenario exercises (for the report). */
  skill: string
  /** Execution backend. Default `cli`. */
  backend?: ScenarioBackend
  /** Executable to run (e.g. `node`). */
  command: string
  /** Arguments passed to `command`. */
  args: string[]
  /** Optional stdin fed to the process. */
  stdin?: string
  /** Per-iteration timeout in ms (default 30s). */
  timeoutMs?: number
  /** Expected outcome assertions. */
  expect: ScenarioExpectation
}

/** Timing percentiles for a scenario's repeated runs. */
export interface ScenarioTiming {
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  samples: number
}

/** Scored result for one scenario. */
export interface ScenarioResult {
  name: string
  skill: string
  backend: ScenarioBackend
  iterations: number
  /** Number of iterations whose assertions all held. */
  passes: number
  /** passes / iterations (0..1). */
  passRate: number
  /** True iff passRate === 1 (all iterations passed). */
  passed: boolean
  /** True iff every iteration agreed (all-pass or all-fail) — flakiness signal. */
  stable: boolean
  /** Distinct assertion failures observed across iterations. */
  failures: string[]
  /** Wall-clock timing percentiles across iterations. */
  timing: ScenarioTiming
}

/** A fixture that could not be loaded/parsed. */
interface ScenarioLoadError {
  file: string
  error: string
}

/** Aggregate eval result. */
export interface SkillEvalResult {
  scenarios: ScenarioResult[]
  totalScenarios: number
  passedScenarios: number
  /** True iff every scenario passed (and at least one ran). */
  passed: boolean
  /** Regression lines vs baseline pass rates. */
  regressions: string[]
  /** Fixtures that failed to load. */
  loadErrors: ScenarioLoadError[]
}

export interface SkillEvalOptions {
  /** Directory containing scenario `*.json` fixtures. */
  scenariosDir?: string
  /** Iterations per scenario (default 5). */
  iterations?: number
  /** Optional baseline file mapping scenario name → baseline pass rate (0..1). */
  baselineFile?: string
  /** Emit a JSON envelope to stdout. */
  json?: boolean
  /** Write an HTML report to this path. */
  htmlFile?: string
  /** Project root used to resolve default paths. */
  dir?: string
}

const DEFAULT_ITERATIONS = 5
const DEFAULT_SCENARIO_TIMEOUT_MS = 30_000
const REGRESSION_DROP = 0.0001 // any measurable pass-rate drop counts

// ── fixture loading ──────────────────────────────────────────────────────────

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

function parseEnvelope(value: unknown): Record<string, string | number | boolean> {
  const env: Record<string, string | number | boolean> = {}
  if (typeof value !== 'object' || value === null) return env
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isPrimitive(v)) env[k] = v
  }
  return env
}

function parseExpectation(value: unknown): ScenarioExpectation {
  if (typeof value !== 'object' || value === null) return {}
  const obj = value as Record<string, unknown>
  const out: ScenarioExpectation = {}
  if (typeof obj.exitCode === 'number') out.exitCode = obj.exitCode
  if (typeof obj.stdoutMatches === 'string') out.stdoutMatches = obj.stdoutMatches
  if (typeof obj.stderrMatches === 'string') out.stderrMatches = obj.stderrMatches
  if (typeof obj.jsonEnvelope === 'object' && obj.jsonEnvelope !== null) {
    out.jsonEnvelope = parseEnvelope(obj.jsonEnvelope)
  }
  return out
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.length === 0) throw new Error(`missing "${key}"`)
  return v
}

function parseScenario(raw: unknown): Scenario {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`expected a JSON object, got ${Array.isArray(raw) ? 'array' : typeof raw}`)
  }
  const obj = raw as Record<string, unknown>
  if (!isStringArray(obj.args)) throw new Error('"args" must be a string array')
  const name = requireString(obj, 'name')
  const scenario: Scenario = {
    name,
    skill: typeof obj.skill === 'string' ? obj.skill : name,
    backend: obj.backend === 'llm' ? 'llm' : 'cli',
    command: requireString(obj, 'command'),
    args: obj.args,
    expect: parseExpectation(obj.expect),
  }
  if (typeof obj.stdin === 'string') scenario.stdin = obj.stdin
  if (typeof obj.timeoutMs === 'number') scenario.timeoutMs = obj.timeoutMs
  return scenario
}

interface LoadedScenarios {
  scenarios: Scenario[]
  loadErrors: ScenarioLoadError[]
}

function loadScenarios(scenariosDir: string): LoadedScenarios {
  if (!existsSync(scenariosDir)) {
    throw new Error(
      `No scenarios directory found at ${scenariosDir}. Create scenario fixtures first.`,
    )
  }
  const files = readdirSync(scenariosDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
  const scenarios: Scenario[] = []
  const loadErrors: ScenarioLoadError[] = []
  for (const file of files) {
    const full = join(scenariosDir, file)
    try {
      const raw: unknown = JSON.parse(readFileSync(full, 'utf-8'))
      scenarios.push(parseScenario(raw))
    } catch (err) {
      loadErrors.push({ file, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { scenarios, loadErrors }
}

function loadBaseline(baselineFile: string): Record<string, number> | null {
  const raw = readBaselineFileSafe(baselineFile)
  if (raw === null) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number') out[k] = v
  }
  return out
}

// ── scenario execution + scoring ─────────────────────────────────────────────

interface RunOutcome {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

function runScenarioOnce(scenario: Scenario): RunOutcome {
  const opts: import('../utils/run-cli.js').RunCliOptions = {
    timeoutMs: scenario.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
    env: { ...process.env, ARBITER_PLAN_BYPASS: '1' },
  }
  if (scenario.stdin !== undefined) opts.input = scenario.stdin
  const start = process.hrtime.bigint()
  try {
    const r = runCli(scenario.command, scenario.args, opts)
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, durationMs }
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    if (err instanceof CliError) {
      return { exitCode: err.exitCode, stdout: err.stdout, stderr: err.stderr, durationMs }
    }
    return { exitCode: -1, stdout: '', stderr: String(err), durationMs }
  }
}

/**
 * Test whether `haystack` matches the fixture-supplied `pattern`. The pattern is
 * untrusted regex source (a scenario's `expect.stdoutMatches`), so a bare
 * try/catch is not enough: it traps only invalid SYNTAX, never a valid but
 * catastrophic-backtracking pattern such as `(a+)+$`, which would hang the
 * skill-eval harness on hostile stdout (#1551). Short-circuit the
 * nested-unbounded-quantifier family to a literal substring test before
 * compiling — the same guard the conformance engine applies to its dynamic
 * RegExp builds. Exported for the ReDoS-timeout regression test.
 */
export function matchOk(haystack: string, pattern: string): boolean {
  if (hasNestedUnboundedQuantifier(pattern)) return haystack.includes(pattern)
  try {
    return new RegExp(pattern).test(haystack)
  } catch {
    return haystack.includes(pattern)
  }
}

function scoreEnvelope(
  stdout: string,
  expected: Record<string, string | number | boolean>,
  failures: Set<string>,
): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    failures.add('jsonEnvelope: stdout is not valid JSON')
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) {
    failures.add('jsonEnvelope: stdout JSON is not an object')
    return false
  }
  const obj = parsed as Record<string, unknown>
  let ok = true
  for (const [key, want] of Object.entries(expected)) {
    if (obj[key] !== want) {
      failures.add(
        `jsonEnvelope.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(obj[key])}`,
      )
      ok = false
    }
  }
  return ok
}

/** Evaluate one outcome against the scenario's expectations. Records failures. */
function scoreOutcome(
  outcome: RunOutcome,
  expect: ScenarioExpectation,
  failures: Set<string>,
): boolean {
  let ok = true
  if (expect.exitCode !== undefined && outcome.exitCode !== expect.exitCode) {
    failures.add(`exitCode: expected ${expect.exitCode}, got ${outcome.exitCode}`)
    ok = false
  }
  if (expect.stdoutMatches !== undefined && !matchOk(outcome.stdout, expect.stdoutMatches)) {
    failures.add(`stdoutMatches: /${expect.stdoutMatches}/ did not match`)
    ok = false
  }
  if (expect.stderrMatches !== undefined && !matchOk(outcome.stderr, expect.stderrMatches)) {
    failures.add(`stderrMatches: /${expect.stderrMatches}/ did not match`)
    ok = false
  }
  if (
    expect.jsonEnvelope !== undefined &&
    !scoreEnvelope(outcome.stdout, expect.jsonEnvelope, failures)
  ) {
    ok = false
  }
  return ok
}

function percentiles(timings: number[]): ScenarioTiming {
  const sorted = [...timings].sort((a, b) => a - b)
  const pct = (p: number): number => sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? 0
  const round = (n: number): number => Math.round(n * 100) / 100
  return {
    p50: round(pct(50)),
    p95: round(pct(95)),
    p99: round(pct(99)),
    min: round(sorted[0] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
    samples: sorted.length,
  }
}

function evaluateScenario(scenario: Scenario, iterations: number): ScenarioResult {
  const failures = new Set<string>()
  const timings: number[] = []
  let passes = 0
  for (let i = 0; i < iterations; i++) {
    const outcome = runScenarioOnce(scenario)
    timings.push(outcome.durationMs)
    if (scoreOutcome(outcome, scenario.expect, failures)) passes += 1
  }
  const passRate = iterations > 0 ? passes / iterations : 0
  return {
    name: scenario.name,
    skill: scenario.skill,
    backend: scenario.backend ?? 'cli',
    iterations,
    passes,
    passRate: Math.round(passRate * 10000) / 10000,
    passed: passes === iterations && iterations > 0,
    stable: passes === 0 || passes === iterations,
    failures: [...failures],
    timing: percentiles(timings),
  }
}

function detectRegressions(
  results: ScenarioResult[],
  baseline: Record<string, number> | null,
): string[] {
  if (!baseline) return []
  const regressions: string[] = []
  for (const r of results) {
    const base = baseline[r.name]
    if (typeof base === 'number' && r.passRate < base - REGRESSION_DROP) {
      regressions.push(
        `${r.name}: pass rate ${(r.passRate * 100).toFixed(0)}% vs baseline ${(base * 100).toFixed(0)}%`,
      )
    }
  }
  return regressions
}

// ── reporting ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render a self-contained HTML report from an eval result. */
export function renderHtmlReport(result: SkillEvalResult): string {
  const rows = result.scenarios
    .map((s) => {
      const status = s.passed ? '✅' : '❌'
      const flaky = s.stable ? '' : ' ⚠ flaky'
      const fail =
        s.failures.length > 0 ? `<br><small>${escapeHtml(s.failures.join('; '))}</small>` : ''
      return (
        `<tr class="${s.passed ? 'pass' : 'fail'}">` +
        `<td>${status} ${escapeHtml(s.name)}${flaky}</td>` +
        `<td>${escapeHtml(s.skill)}</td>` +
        `<td>${(s.passRate * 100).toFixed(0)}%</td>` +
        `<td>${s.timing.p50}ms</td>` +
        `<td>${s.timing.p95}ms</td>` +
        `<td>${escapeHtml(s.backend)}${fail}</td>` +
        `</tr>`
      )
    })
    .join('\n')
  const regBlock =
    result.regressions.length > 0
      ? `<h2>Regressions</h2><ul>${result.regressions.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
      : ''
  const errBlock =
    result.loadErrors.length > 0
      ? `<h2>Load errors</h2><ul>${result.loadErrors.map((e) => `<li>${escapeHtml(e.file)}: ${escapeHtml(e.error)}</li>`).join('')}</ul>`
      : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Skill/Command Regression Eval</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#111}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}
tr.pass{background:#f3fbf3}tr.fail{background:#fdf3f3}
small{color:#a00}
</style>
</head>
<body>
<h1>Skill/Command Regression Eval</h1>
<p>${result.passedScenarios}/${result.totalScenarios} scenarios passed — overall <strong>${result.passed ? 'PASS' : 'FAIL'}</strong></p>
<table>
<thead><tr><th>Scenario</th><th>Skill</th><th>Pass rate</th><th>p50</th><th>p95</th><th>Backend / failures</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${regBlock}
${errBlock}
</body>
</html>
`
}

function printHumanResults(result: SkillEvalResult): void {
  process.stdout.write(`Skill/Command Regression Eval\n\n`)
  process.stdout.write(
    `${'Scenario'.padEnd(28)} ${'pass%'.padStart(6)} ${'p50'.padStart(8)} ${'p95'.padStart(8)}  status\n`,
  )
  process.stdout.write(`${'-'.repeat(70)}\n`)
  for (const s of result.scenarios) {
    const status = s.passed ? 'PASS' : 'FAIL'
    const flaky = s.stable ? '' : ' (flaky)'
    process.stdout.write(
      `${s.name.padEnd(28)} ${`${Math.round(s.passRate * 100)}%`.padStart(6)} ` +
        `${`${s.timing.p50}ms`.padStart(8)} ${`${s.timing.p95}ms`.padStart(8)}  ${status}${flaky}\n`,
    )
    for (const f of s.failures) process.stdout.write(`    - ${f}\n`)
  }
  process.stdout.write(
    `\n${result.passedScenarios}/${result.totalScenarios} scenarios passed — overall ${result.passed ? 'PASS' : 'FAIL'}\n`,
  )
  if (result.regressions.length > 0) {
    process.stdout.write(`\nRegressions vs baseline:\n`)
    for (const r of result.regressions) process.stdout.write(`  ${r}\n`)
  }
  if (result.loadErrors.length > 0) {
    process.stdout.write(`\nFixture load errors:\n`)
    for (const e of result.loadErrors) process.stdout.write(`  ${e.file}: ${e.error}\n`)
  }
}

// ── entry point ──────────────────────────────────────────────────────────────

export function runSkillEval(opts: SkillEvalOptions = {}): SkillEvalResult {
  const dir = resolve(opts.dir ?? process.cwd())
  const scenariosDir = resolve(
    opts.scenariosDir ?? join(dir, '__tests__', 'fixtures', 'skill-eval-scenarios'),
  )
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS

  const { scenarios, loadErrors } = loadScenarios(scenariosDir)
  const baseline = opts.baselineFile ? loadBaseline(opts.baselineFile) : null

  const scenarioResults = scenarios
    .filter((s) => s.backend !== 'llm') // llm backend is a deferred seam, not wired
    .map((s) => evaluateScenario(s, iterations))

  const passedScenarios = scenarioResults.filter((s) => s.passed).length
  const result: SkillEvalResult = {
    scenarios: scenarioResults,
    totalScenarios: scenarioResults.length,
    passedScenarios,
    passed: scenarioResults.length > 0 && passedScenarios === scenarioResults.length,
    regressions: detectRegressions(scenarioResults, baseline),
    loadErrors,
  }

  if (opts.htmlFile) {
    const htmlPath = resolve(opts.htmlFile)
    mkdirSync(dirname(htmlPath), { recursive: true })
    writeFileSync(htmlPath, renderHtmlReport(result))
  }

  if (opts.json) {
    jsonOutput(
      'skill-eval',
      result.passed ? 'ok' : 'error',
      result as unknown as Record<string, unknown>,
      [],
    )
  } else {
    printHumanResults(result)
  }

  return result
}
