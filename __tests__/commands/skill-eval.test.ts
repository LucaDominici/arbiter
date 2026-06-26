// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runSkillEval, renderHtmlReport, matchOk } from '../../src/commands/skill-eval.js'
import type { Scenario, SkillEvalResult } from '../../src/commands/skill-eval.js'

/** A scenario that always passes: node prints fixed JSON and exits 0. */
function passingScenario(name = 'standard-completion'): Scenario {
  return {
    name,
    skill: 'demo',
    backend: 'cli',
    command: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({status:"ok"}));process.exit(0)'],
    expect: {
      exitCode: 0,
      stdoutMatches: 'ok',
    },
  }
}

/** A scenario that always fails an assertion: exit code mismatch. */
function failingScenario(name = 'gate-failure'): Scenario {
  return {
    name,
    skill: 'demo',
    backend: 'cli',
    command: process.execPath,
    args: ['-e', 'process.exit(3)'],
    expect: {
      exitCode: 0, // real exit is 3 → assertion fails
    },
  }
}

function writeScenarios(dir: string, scenarios: Scenario[]): string {
  const scenarioDir = join(dir, 'scenarios')
  mkdirSync(scenarioDir, { recursive: true })
  for (const s of scenarios) {
    writeFileSync(join(scenarioDir, `${s.name}.json`), JSON.stringify(s, null, 2))
  }
  return scenarioDir
}

describe('runSkillEval (#1264)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-skilleval-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('scores a passing scenario as passed with 100% pass rate', () => {
    const scenarioDir = writeScenarios(dir, [passingScenario()])
    const result: SkillEvalResult = runSkillEval({ scenariosDir: scenarioDir, iterations: 3 })
    expect(result.scenarios).toHaveLength(1)
    const sc = result.scenarios[0]!
    expect(sc.name).toBe('standard-completion')
    expect(sc.passed).toBe(true)
    expect(sc.passRate).toBe(1)
    expect(sc.iterations).toBe(3)
  })

  it('scores a failing scenario as failed with 0% pass rate', () => {
    const scenarioDir = writeScenarios(dir, [failingScenario()])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 3 })
    const sc = result.scenarios[0]!
    expect(sc.passed).toBe(false)
    expect(sc.passRate).toBe(0)
    expect(sc.failures.length).toBeGreaterThan(0)
  })

  it('reports outcome stability (every iteration agrees) for a deterministic scenario', () => {
    const scenarioDir = writeScenarios(dir, [passingScenario()])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 4 })
    expect(result.scenarios[0]!.stable).toBe(true)
  })

  it('emits timing percentiles per scenario', () => {
    const scenarioDir = writeScenarios(dir, [passingScenario()])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 3 })
    const t = result.scenarios[0]!.timing
    expect(t.p50).toBeGreaterThanOrEqual(0)
    expect(t.p95).toBeGreaterThanOrEqual(t.p50)
    expect(t.samples).toBe(3)
  })

  it('aggregates an overall passed flag (all scenarios pass)', () => {
    const scenarioDir = writeScenarios(dir, [passingScenario('a'), passingScenario('b')])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 2 })
    expect(result.passed).toBe(true)
    expect(result.totalScenarios).toBe(2)
    expect(result.passedScenarios).toBe(2)
  })

  it('overall failed when any scenario fails', () => {
    const scenarioDir = writeScenarios(dir, [passingScenario('ok'), failingScenario('bad')])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 2 })
    expect(result.passed).toBe(false)
    expect(result.passedScenarios).toBe(1)
  })

  it('detects regression vs baseline when pass rate drops', () => {
    const scenarioDir = writeScenarios(dir, [failingScenario('reg')])
    const baselineFile = join(dir, 'baseline.json')
    // Baseline says this scenario used to pass 100%; now it is 0% → regression.
    writeFileSync(baselineFile, JSON.stringify({ reg: 1 }))
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 2, baselineFile })
    expect(result.regressions.length).toBeGreaterThan(0)
    expect(result.regressions[0]).toMatch(/reg/)
  })

  it('no regression when baseline is absent', () => {
    const scenarioDir = writeScenarios(dir, [passingScenario()])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 2 })
    expect(result.regressions).toHaveLength(0)
  })

  it('handles a malformed scenario fixture without throwing', () => {
    const scenarioDir = join(dir, 'scenarios')
    mkdirSync(scenarioDir, { recursive: true })
    writeFileSync(join(scenarioDir, 'broken.json'), '{ not valid json ')
    writeFileSync(join(scenarioDir, 'good.json'), JSON.stringify(passingScenario('good'), null, 2))
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 2 })
    // Good scenario still ran; malformed recorded as a load error.
    expect(result.scenarios.some((s) => s.name === 'good')).toBe(true)
    expect(result.loadErrors.length).toBeGreaterThan(0)
  })

  it('throws when scenarios directory does not exist', () => {
    expect(() => runSkillEval({ scenariosDir: join(dir, 'nope'), iterations: 1 })).toThrow(
      /scenarios directory/i,
    )
  })

  it('writes an HTML report when htmlFile is given', () => {
    const scenarioDir = writeScenarios(dir, [passingScenario()])
    const htmlFile = join(dir, 'report.html')
    runSkillEval({ scenariosDir: scenarioDir, iterations: 2, htmlFile })
    expect(existsSync(htmlFile)).toBe(true)
    const html = readFileSync(htmlFile, 'utf-8')
    expect(html).toContain('<html')
    expect(html).toContain('standard-completion')
  })

  it('renderHtmlReport produces self-contained HTML from a result', () => {
    const scenarioDir = writeScenarios(dir, [passingScenario()])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 2 })
    const html = renderHtmlReport(result)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Skill/Command Regression Eval')
  })
})

describe('matchOk ReDoS hardening (#1551)', () => {
  // The fixture-supplied `stdoutMatches` pattern is untrusted. A catastrophic-
  // backtracking regex fed a non-matching haystack hangs `new RegExp().test()`
  // for tens of seconds; the previous bare try/catch only trapped invalid
  // SYNTAX. A 2s test timeout makes the hang a hard RED on the unfixed code.
  it('returns promptly for a nested-unbounded-quantifier pattern on hostile stdout', () => {
    // `(a+)+$` over a long run of 'a' ending in a non-'a' is the canonical
    // exponential-backtracking trigger.
    const haystack = `${'a'.repeat(50)}X`
    // The guard short-circuits to a literal substring test: the pattern string
    // is not present verbatim, so the answer is false — and, crucially, instant.
    expect(matchOk(haystack, '(a+)+$')).toBe(false)
    // A literal substring that IS present still matches via the includes() path.
    expect(matchOk(`see (a+)+$ here`, '(a+)+$')).toBe(true)
  }, 2000)

  it('still compiles and matches a safe regex pattern', () => {
    expect(matchOk('status: ok', '^status: ok$')).toBe(true)
    expect(matchOk('status: fail', '^status: ok$')).toBe(false)
  })

  it('falls back to substring on an invalid-syntax pattern', () => {
    // An unbalanced group is a syntax error → catch → literal includes().
    expect(matchOk('has (oops literal', '(oops')).toBe(true)
    expect(matchOk('no match here', '(oops')).toBe(false)
  })
})
