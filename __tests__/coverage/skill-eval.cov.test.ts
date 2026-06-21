// SPDX-License-Identifier: Apache-2.0
//
// Branch-coverage climb for src/commands/skill-eval.ts (#1486).
// Exercises the uncovered conditional arms of the skill-eval harness: fixture
// parsing guards, baseline loading, scenario execution error paths, the scoring
// matchers (regex vs substring, JSON-envelope), percentile edge cases, regression
// detection, the HTML report sub-blocks, and the runSkillEval entry-point flags.
//
// Test-only: builds real temp fixture dirs (mkdtempSync) and stubs process.stdout
// /process.stderr writes. No real network/git/gh. The harness only spawns short
// `node -e` snippets via the real run-cli util, which is deterministic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runSkillEval,
  renderHtmlReport,
  type Scenario,
  type SkillEvalResult,
  type ScenarioResult,
  type ScenarioTiming,
} from '../../src/commands/skill-eval.js'

// ── fixture helpers ──────────────────────────────────────────────────────────

/** A scenario whose run always passes the given expectation (prints JSON, exit 0). */
function okScenario(name: string, expect: Scenario['expect'] = { exitCode: 0 }): Scenario {
  return {
    name,
    skill: 'demo',
    backend: 'cli',
    command: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({status:"ok",n:1}));process.exit(0)'],
    expect,
  }
}

/** Write an array of raw fixture objects to a fresh scenarios dir; returns its path. */
function writeRawFixtures(root: string, fixtures: Array<{ file: string; body: string }>): string {
  const scenarioDir = join(root, 'scenarios')
  mkdirSync(scenarioDir, { recursive: true })
  for (const fx of fixtures) writeFileSync(join(scenarioDir, fx.file), fx.body)
  return scenarioDir
}

/** Write structured Scenario objects (one JSON file each). */
function writeScenarios(root: string, scenarios: Scenario[]): string {
  return writeRawFixtures(
    root,
    scenarios.map((s) => ({ file: `${s.name}.json`, body: JSON.stringify(s, null, 2) })),
  )
}

/** Build a minimal ScenarioResult for renderHtmlReport unit tests. */
function makeScenarioResult(over: Partial<ScenarioResult> = {}): ScenarioResult {
  const timing: ScenarioTiming = { p50: 1, p95: 2, p99: 3, min: 1, max: 3, samples: 1 }
  return {
    name: 'sc',
    skill: 'demo',
    backend: 'cli',
    iterations: 1,
    passes: 1,
    passRate: 1,
    passed: true,
    stable: true,
    failures: [],
    timing,
    ...over,
  }
}

function makeResult(over: Partial<SkillEvalResult> = {}): SkillEvalResult {
  return {
    scenarios: [],
    totalScenarios: 0,
    passedScenarios: 0,
    passed: false,
    regressions: [],
    loadErrors: [],
    ...over,
  }
}

describe('skill-eval branch coverage (#1486)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-skilleval-cov-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  // ── parseScenario guards (via load errors / fallbacks) ─────────────────────

  it('records a load error when a fixture is a JSON array (not an object)', () => {
    const scenarioDir = writeRawFixtures(dir, [{ file: 'arr.json', body: '[1,2,3]' }])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.loadErrors).toHaveLength(1)
    expect(result.loadErrors[0]!.error).toMatch(/array/)
    expect(result.scenarios).toHaveLength(0)
  })

  it('records a load error when a fixture is a JSON primitive (not an object)', () => {
    const scenarioDir = writeRawFixtures(dir, [{ file: 'num.json', body: '42' }])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.loadErrors[0]!.error).toMatch(/number/)
  })

  it('records a load error when "args" is not a string array', () => {
    const scenarioDir = writeRawFixtures(dir, [
      { file: 'badargs.json', body: JSON.stringify({ name: 'x', command: 'node', args: [1, 2] }) },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.loadErrors[0]!.error).toMatch(/args/)
  })

  it('records a load error when "args" is missing entirely', () => {
    const scenarioDir = writeRawFixtures(dir, [
      { file: 'noargs.json', body: JSON.stringify({ name: 'x', command: 'node' }) },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.loadErrors[0]!.error).toMatch(/args/)
  })

  it('records a load error when required string "name" is missing', () => {
    const scenarioDir = writeRawFixtures(dir, [
      { file: 'noname.json', body: JSON.stringify({ command: 'node', args: [] }) },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.loadErrors[0]!.error).toMatch(/name/)
  })

  it('records a load error when required string "command" is missing', () => {
    const scenarioDir = writeRawFixtures(dir, [
      { file: 'nocmd.json', body: JSON.stringify({ name: 'x', args: [] }) },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.loadErrors[0]!.error).toMatch(/command/)
  })

  it('records a load error when required string is present but empty', () => {
    const scenarioDir = writeRawFixtures(dir, [
      { file: 'emptyname.json', body: JSON.stringify({ name: '', command: 'node', args: [] }) },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.loadErrors[0]!.error).toMatch(/name/)
  })

  it('falls back skill→name when "skill" is not a string, and parses optional stdin/timeoutMs', () => {
    // No "skill" key → skill defaults to name. stdin echoed to stdout; custom timeoutMs.
    const scenarioDir = writeRawFixtures(dir, [
      {
        file: 'sc.json',
        body: JSON.stringify({
          name: 'fallback',
          command: process.execPath,
          args: ['-e', 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{process.stdout.write(d);process.exit(0)})'],
          stdin: 'hello-stdin',
          timeoutMs: 15000,
          expect: { exitCode: 0, stdoutMatches: 'hello-stdin' },
        }),
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.loadErrors).toHaveLength(0)
    const sc = result.scenarios[0]!
    expect(sc.skill).toBe('fallback') // skill fell back to name
    expect(sc.passed).toBe(true)
  })

  // ── backend parsing + llm filtering ────────────────────────────────────────

  it('coerces an unknown backend to cli, and an explicit llm scenario is filtered out of results', () => {
    const cliUnknown: Scenario = { ...okScenario('cli-unknown'), backend: 'foo' as Scenario['backend'] }
    const llm: Scenario = { ...okScenario('llm-one'), backend: 'llm' }
    const scenarioDir = writeScenarios(dir, [cliUnknown, llm])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    // unknown backend coerced to cli → ran; llm filtered → not in results.
    expect(result.scenarios.map((s) => s.name)).toEqual(['cli-unknown'])
    expect(result.scenarios[0]!.backend).toBe('cli')
  })

  // ── parseExpectation / parseEnvelope branches ──────────────────────────────

  it('treats a non-object "expect" as no assertions (every iteration passes vacuously)', () => {
    const scenarioDir = writeRawFixtures(dir, [
      {
        file: 'noexpect.json',
        body: JSON.stringify({
          name: 'vacuous',
          command: process.execPath,
          args: ['-e', 'process.exit(7)'],
          expect: 'not-an-object',
        }),
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    // No assertions → passes even though exit is 7.
    expect(result.scenarios[0]!.passed).toBe(true)
  })

  it('filters non-primitive jsonEnvelope values and matches the primitive ones', () => {
    const scenarioDir = writeRawFixtures(dir, [
      {
        file: 'env.json',
        body: JSON.stringify({
          name: 'env',
          command: process.execPath,
          args: ['-e', 'process.stdout.write(JSON.stringify({status:"ok",count:2}));process.exit(0)'],
          expect: {
            // nested object is dropped by parseEnvelope; only primitives kept.
            jsonEnvelope: { status: 'ok', count: 2, dropped: { a: 1 } },
          },
        }),
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.passed).toBe(true)
  })

  it('ignores a jsonEnvelope that is not an object in expect', () => {
    const scenarioDir = writeRawFixtures(dir, [
      {
        file: 'badenv.json',
        body: JSON.stringify({
          name: 'badenv',
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          expect: { jsonEnvelope: 'nope' },
        }),
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    // jsonEnvelope wasn't an object → not parsed → no assertion → passes.
    expect(result.scenarios[0]!.passed).toBe(true)
  })

  // ── scoreEnvelope branches ─────────────────────────────────────────────────

  it('fails jsonEnvelope assertion when stdout is not valid JSON', () => {
    const scenarioDir = writeScenarios(dir, [
      {
        name: 'notjson',
        skill: 'demo',
        backend: 'cli',
        command: process.execPath,
        args: ['-e', 'process.stdout.write("plain text");process.exit(0)'],
        expect: { jsonEnvelope: { status: 'ok' } },
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.passed).toBe(false)
    expect(result.scenarios[0]!.failures.some((f) => /not valid JSON/.test(f))).toBe(true)
  })

  it('fails jsonEnvelope assertion when stdout JSON is a primitive (not an object)', () => {
    // `null` is valid JSON but `parsed === null` → "stdout JSON is not an object".
    const scenarioDir = writeScenarios(dir, [
      {
        name: 'jsonprim',
        skill: 'demo',
        backend: 'cli',
        command: process.execPath,
        args: ['-e', 'process.stdout.write("null");process.exit(0)'],
        expect: { jsonEnvelope: { status: 'ok' } },
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.failures.some((f) => /not an object/.test(f))).toBe(true)
  })

  it('fails jsonEnvelope assertion on a value mismatch (records expected/got)', () => {
    const scenarioDir = writeScenarios(dir, [
      {
        name: 'mismatch',
        skill: 'demo',
        backend: 'cli',
        command: process.execPath,
        args: ['-e', 'process.stdout.write(JSON.stringify({status:"bad"}));process.exit(0)'],
        expect: { jsonEnvelope: { status: 'ok' } },
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.failures.some((f) => /jsonEnvelope\.status/.test(f))).toBe(true)
  })

  // ── matchOk: regex path vs invalid-regex substring fallback ────────────────

  it('uses regex matching for stdoutMatches when the pattern is a valid regex', () => {
    const scenarioDir = writeScenarios(dir, [okScenario('rx', { stdoutMatches: 'st.tus' })])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.passed).toBe(true)
  })

  it('falls back to substring matching when stdoutMatches is an invalid regex', () => {
    // "[" is an invalid regex → RegExp ctor throws → falls back to includes().
    const scenarioDir = writeScenarios(dir, [
      {
        name: 'badrx',
        skill: 'demo',
        backend: 'cli',
        command: process.execPath,
        args: ['-e', 'process.stdout.write("has [ bracket");process.exit(0)'],
        expect: { stdoutMatches: '[' },
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.passed).toBe(true)
  })

  it('records a stdoutMatches failure when neither regex nor substring matches', () => {
    const scenarioDir = writeScenarios(dir, [okScenario('miss', { stdoutMatches: 'ZZZ-absent' })])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.failures.some((f) => /stdoutMatches/.test(f))).toBe(true)
  })

  // ── scoreOutcome: stderrMatches + exitCode arms ────────────────────────────

  it('matches stderrMatches and exitCode together (both arms exercised)', () => {
    const scenarioDir = writeScenarios(dir, [
      {
        name: 'stderr',
        skill: 'demo',
        backend: 'cli',
        command: process.execPath,
        args: ['-e', 'process.stderr.write("boom-on-stderr");process.exit(5)'],
        expect: { exitCode: 5, stderrMatches: 'boom-on-stderr' },
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.passed).toBe(true)
  })

  it('records a stderrMatches failure when stderr does not match', () => {
    const scenarioDir = writeScenarios(dir, [
      {
        name: 'stderrmiss',
        skill: 'demo',
        backend: 'cli',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        expect: { stderrMatches: 'never-emitted' },
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.failures.some((f) => /stderrMatches/.test(f))).toBe(true)
  })

  // ── runScenarioOnce: CliError catch (non-zero exit) vs generic catch ────────

  it('captures a non-zero exit via CliError and scores the exitCode assertion', () => {
    // runCli throws CliError on non-zero exit; harness must capture exitCode 3.
    const scenarioDir = writeScenarios(dir, [
      {
        name: 'nonzero',
        skill: 'demo',
        backend: 'cli',
        command: process.execPath,
        args: ['-e', 'process.exit(3)'],
        expect: { exitCode: 3 },
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.passed).toBe(true)
  })

  it('handles a non-CliError spawn failure as exitCode -1 (command not found)', () => {
    // A bogus command makes runCli throw a non-CliError → generic catch → exit -1.
    const scenarioDir = writeScenarios(dir, [
      {
        name: 'nocommand',
        skill: 'demo',
        backend: 'cli',
        command: join(dir, 'this-binary-does-not-exist-xyz'),
        args: [],
        expect: { exitCode: -1 },
      },
    ])
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.scenarios[0]!.passed).toBe(true)
  })

  // ── loadBaseline branches (number filtering, invalid JSON, structure) ──────

  it('keeps only numeric baseline values and ignores non-number entries', () => {
    const scenarioDir = writeScenarios(dir, [okScenario('a'), okScenario('b')])
    const baselineFile = join(dir, 'baseline.json')
    // "a" numeric (will not regress since it passes 100%); "b" non-number → ignored.
    writeFileSync(baselineFile, JSON.stringify({ a: 1, b: 'not-a-number' }))
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1, baselineFile })
    expect(result.regressions).toHaveLength(0)
  })

  it('disables regression detection when the baseline file is missing (null)', () => {
    const scenarioDir = writeScenarios(dir, [okScenario('a')])
    const result = runSkillEval({
      scenariosDir: scenarioDir,
      iterations: 1,
      baselineFile: join(dir, 'absent-baseline.json'),
    })
    expect(result.regressions).toHaveLength(0)
  })

  it('disables regression detection when the baseline JSON is invalid', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const scenarioDir = writeScenarios(dir, [okScenario('a')])
    const baselineFile = join(dir, 'invalid-baseline.json')
    writeFileSync(baselineFile, '{ not json ')
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1, baselineFile })
    expect(result.regressions).toHaveLength(0)
    expect(stderr).toHaveBeenCalled()
  })

  it('disables regression detection when the baseline structure is an array', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const scenarioDir = writeScenarios(dir, [okScenario('a')])
    const baselineFile = join(dir, 'arr-baseline.json')
    writeFileSync(baselineFile, '[1,2,3]')
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1, baselineFile })
    expect(result.regressions).toHaveLength(0)
    expect(stderr).toHaveBeenCalled()
  })

  // ── detectRegressions: base-not-a-number arm + no-drop arm ─────────────────

  it('does not flag a regression when the baseline entry for a scenario is absent', () => {
    const scenarioDir = writeScenarios(dir, [
      {
        name: 'fails',
        skill: 'demo',
        backend: 'cli',
        command: process.execPath,
        args: ['-e', 'process.exit(9)'],
        expect: { exitCode: 0 },
      },
    ])
    const baselineFile = join(dir, 'baseline.json')
    // baseline mentions a different scenario only → no base for "fails".
    writeFileSync(baselineFile, JSON.stringify({ other: 1 }))
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1, baselineFile })
    expect(result.regressions).toHaveLength(0)
  })

  // ── runSkillEval: json output flag + empty scenarios + default iterations ──

  it('emits a JSON envelope to stdout when json:true', () => {
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    })
    const scenarioDir = writeScenarios(dir, [okScenario('jsonsc')])
    runSkillEval({ scenariosDir: scenarioDir, iterations: 1, json: true })
    const joined = writes.join('')
    expect(joined).toContain('"command"')
    expect(joined).toContain('skill-eval')
  })

  it('prints a human report (default, non-json) including a flaky-free PASS line', () => {
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    })
    const scenarioDir = writeScenarios(dir, [okScenario('humansc')])
    runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    const joined = writes.join('')
    expect(joined).toContain('Skill/Command Regression Eval')
    expect(joined).toContain('PASS')
  })

  it('reports overall failed (passed=false) when there are zero scenarios to run', () => {
    const scenarioDir = join(dir, 'scenarios')
    mkdirSync(scenarioDir, { recursive: true })
    // empty dir → no fixtures → no scenarios.
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    })
    const result = runSkillEval({ scenariosDir: scenarioDir, iterations: 1 })
    expect(result.totalScenarios).toBe(0)
    expect(result.passed).toBe(false)
  })

  it('uses the default iterations (5) and default scenariosDir resolution via dir', () => {
    // Place fixtures under the conventional default path relative to `dir`.
    const defaultDir = join(dir, '__tests__', 'fixtures', 'skill-eval-scenarios')
    mkdirSync(defaultDir, { recursive: true })
    writeFileSync(join(defaultDir, 'def.json'), JSON.stringify(okScenario('def'), null, 2))
    const result = runSkillEval({ dir })
    expect(result.scenarios[0]!.iterations).toBe(5)
  })

  it('creates nested directories and writes an HTML report when htmlFile is nested', () => {
    const scenarioDir = writeScenarios(dir, [okScenario('htmlsc')])
    const htmlFile = join(dir, 'nested', 'deep', 'report.html')
    runSkillEval({ scenariosDir: scenarioDir, iterations: 1, htmlFile })
    expect(existsSync(htmlFile)).toBe(true)
    expect(readFileSync(htmlFile, 'utf-8')).toContain('<!doctype html>')
  })

  // ── renderHtmlReport sub-blocks (failures, flaky, regressions, load errors) ─

  it('renders a failed + flaky row with a failures <small> block', () => {
    const failed = makeScenarioResult({
      name: 'broken',
      passed: false,
      stable: false,
      passRate: 0.5,
      failures: ['exitCode: expected 0, got 3', 'stderrMatches: /x/ did not match'],
    })
    const html = renderHtmlReport(makeResult({ scenarios: [failed], totalScenarios: 1 }))
    expect(html).toContain('❌')
    expect(html).toContain('flaky')
    expect(html).toContain('<small>')
    expect(html).toContain('class="fail"')
  })

  it('renders a passing row without a failures block and with a pass class', () => {
    const html = renderHtmlReport(
      makeResult({
        scenarios: [makeScenarioResult({ name: 'good' })],
        totalScenarios: 1,
        passedScenarios: 1,
        passed: true,
      }),
    )
    expect(html).toContain('✅')
    expect(html).toContain('class="pass"')
    expect(html).not.toContain('<small>')
    expect(html).toContain('PASS</strong>')
  })

  it('renders the regressions block and the load-errors block when present, escaping HTML', () => {
    const html = renderHtmlReport(
      makeResult({
        scenarios: [makeScenarioResult()],
        totalScenarios: 1,
        regressions: ['<reg & drop>'],
        loadErrors: [{ file: 'bad.json', error: 'oops <"&>' }],
      }),
    )
    expect(html).toContain('<h2>Regressions</h2>')
    expect(html).toContain('<h2>Load errors</h2>')
    // HTML special chars escaped.
    expect(html).toContain('&lt;reg &amp; drop&gt;')
    expect(html).toContain('&quot;')
  })

  it('omits the regressions and load-errors blocks when both are empty', () => {
    const html = renderHtmlReport(
      makeResult({ scenarios: [makeScenarioResult()], totalScenarios: 1 }),
    )
    expect(html).not.toContain('<h2>Regressions</h2>')
    expect(html).not.toContain('<h2>Load errors</h2>')
  })
})
