// GATE-1 (#2078, leaf of #2041) — `--dry-run` + `--gate <name>` inspection flags
// for the generated consumer gate. Two surfaces:
//   1. run-helpers trio honours a { dryRun, only } mode set via setMode().
//   2. check-all.mjs.ejs parses the flags, wires setMode(), and does NOT stamp
//      a gate-pass marker / result JSON in inspection mode (anti-fake-green).
import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { loadGateRegistry } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

// Render the template run-helpers once to a temp .mjs so a subprocess can import
// it (self-contained: its only import is node:child_process).
let HELPERS: string
beforeAll(() => {
  const content = renderTemplate('scripts/lib/run-helpers.mjs.ejs', {})
  const dir = mkdtempSync(join(tmpdir(), 'arb-rh-'))
  const file = join(dir, 'run-helpers.mjs')
  writeFileSync(file, content)
  HELPERS = pathToFileURL(file).href
})

function runHarness(script: string) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    shell: false,
    env: { ...process.env, NO_COLOR: '1' },
  })
}

describe('run-helpers — dry-run mode', () => {
  it('prints "DRY-RUN (would run: ...)", records SKIP, and never spawns', () => {
    const r = runHarness(`
      import { runCheck, setMode, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      setMode({ dryRun: true });
      // Command that WOULD fail if actually spawned — proves no spawn happened.
      runCheck('typecheck', process.execPath, ['-e', 'process.exit(1)']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('DRY-RUN (would run:')
    const payload = JSON.parse(r.stdout.trim().split('\n').pop()!)
    expect(payload.failed).toBe(0)
    expect(payload.results).toHaveLength(1)
    expect(payload.results[0]).toMatchObject({ name: 'typecheck', status: 'SKIP' })
  })

  it('short-circuits runWarnCheck and runToolCheck too', () => {
    const r = runHarness(`
      import { runWarnCheck, runToolCheck, setMode, getResults } from ${JSON.stringify(HELPERS)};
      setMode({ dryRun: true });
      runWarnCheck('warn-x', process.execPath, ['-e', 'process.exit(1)']);
      runToolCheck('tool-y', 'definitely-not-a-real-binary-xyz', ['--nope']);
      console.log(JSON.stringify({ results: getResults() }));
    `)
    const payload = JSON.parse(r.stdout.trim().split('\n').pop()!)
    expect(payload.results.map((x: { name: string }) => x.name)).toEqual(['warn-x', 'tool-y'])
    expect(payload.results.every((x: { status: string }) => x.status === 'SKIP')).toBe(true)
  })
})

describe('run-helpers — single-gate (only) mode', () => {
  it('runs only the matching check and skips the rest', () => {
    const r = runHarness(`
      import { runCheck, setMode, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      setMode({ only: 'lint' });
      runCheck('typecheck', process.execPath, ['-e', 'process.exit(1)']); // would FAIL — must be skipped
      runCheck('lint', process.execPath, ['-e', 'process.exit(0)']);       // matches — runs, PASS
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const payload = JSON.parse(r.stdout.trim().split('\n').pop()!)
    expect(payload.failed).toBe(0)
    expect(payload.results).toHaveLength(1)
    expect(payload.results[0]).toMatchObject({ name: 'lint', status: 'PASS' })
  })
})

describe('run-helpers — no mode set (regression)', () => {
  it('runs normally when setMode is never called', () => {
    const r = runHarness(`
      import { runCheck, getFailed, getResults } from ${JSON.stringify(HELPERS)};
      runCheck('ok', process.execPath, ['-e', 'process.exit(0)']);
      runCheck('bad', process.execPath, ['-e', 'process.exit(3)']);
      console.log(JSON.stringify({ failed: getFailed(), results: getResults() }));
    `)
    const payload = JSON.parse(r.stdout.trim().split('\n').pop()!)
    expect(payload.failed).toBe(1)
    expect(payload.results.map((x: { status: string }) => x.status)).toEqual(['PASS', 'FAIL'])
  })
})

describe('check-all.mjs.ejs — inspection-flag wiring', () => {
  // Mirrors the generator's enriched render data (generateCheckAll) — the
  // template now embeds the declarative gate registry (#2041).
  const render = () => {
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

  it('parses --dry-run and --gate and wires them into setMode()', () => {
    const content = render()
    expect(content).toContain('--dry-run')
    expect(content).toContain('--gate')
    expect(content).toContain('setMode(')
    expect(content).toContain('setMode,') // imported from run-helpers
  })

  it('does not stamp gate-pass marker or result JSON in inspection mode (anti-fake-green)', () => {
    const content = render()
    // The gate-pass marker write and the arbiter-gate-v1 JSON write are both
    // guarded by the inspection flag so a --dry-run / --gate run cannot fake a pass.
    expect(content).toContain('!_inspect')
    expect(content).toMatch(/&& !_inspect[\s\S]*gate-pass\.json/)
    expect(content).toMatch(/if \(!_inspect\)[\s\S]*arbiter-gate-v1/)
  })

  // Runtime proof that the parser threads argv into setMode() — closes the gap the
  // string assertions above leave. Slices the parse+setMode region (like the #1720
  // clamp test) and runs it against a capturing run-helpers stub.
  function runParse(args: string[]): unknown {
    const content = render()
    const cutIdx = content.indexOf('Grace Period Guard')
    const prefix = content.slice(0, content.lastIndexOf('\n', cutIdx))
    const dir = mkdtempSync(join(tmpdir(), 'arb-parse-'))
    try {
      const scriptsDir = join(dir, 'scripts')
      mkdirSync(join(scriptsDir, 'lib'), { recursive: true })
      writeFileSync(
        join(scriptsDir, 'lib', 'run-helpers.mjs'),
        'export const runCheck = () => {};\nexport const runWarnCheck = () => {};\n' +
          'export const runToolCheck = () => {};\nexport const pushResult = () => {};\n' +
          'export const getResults = () => [];\nexport const getFailed = () => 0;\n' +
          'export const setMode = (m) => console.log("SETMODE:" + JSON.stringify(m));\n' +
          // #2104: the gate resolves a tmpfs TMPDIR before any spawn. Stubbed to null so
          // this harness stays hermetic (no TMPDIR mutation) and host-independent.
          'export const resolveTmpfsTmpdir = () => null;\n' +
          'export const gateFileState = () => "never-emitted";\n' +
          // #2427: the gate arms the orphan guard right after arg-parsing.
          'export const setOrphanGuard = () => {};\n',
      )
      // #2427: and imports the mutex helper, whose lock derivation is stubbed to
      // throw here — this harness runs in a bare temp dir with no git repo, which
      // is exactly the no-mutex-to-take path.
      writeFileSync(
        join(scriptsDir, 'lib', 'gate-mutex.mjs'),
        'export const GATE_MUTEX_HELD_ENV = "ARBITER_GATE_MUTEX_HELD";\n' +
          'export const gateLockPathFor = () => { throw new Error("no repo"); };\n',
      )
      writeFileSync(join(scriptsDir, 'check-all.mjs'), prefix + '\nprocess.exit(0);\n')
      const r = spawnSync('node', [join(scriptsDir, 'check-all.mjs'), ...args], {
        encoding: 'utf-8',
        cwd: dir,
      })
      const m = /SETMODE:(\{.*\})/.exec(r.stdout ?? '')
      return m ? JSON.parse(m[1]) : null
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('threads --dry-run into setMode({ dryRun: true })', () => {
    expect(runParse(['--dry-run'])).toMatchObject({ dryRun: true, only: null })
  })

  it('threads --gate <name> into setMode({ only: name })', () => {
    expect(runParse(['--gate', 'typecheck'])).toMatchObject({
      dryRun: false,
      only: 'typecheck',
    })
  })

  it('leaves setMode a no-op on a normal run', () => {
    expect(runParse(['L2'])).toMatchObject({ dryRun: false, only: null })
  })
})
