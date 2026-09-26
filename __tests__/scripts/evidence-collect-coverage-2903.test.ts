// #2903: the generated TS evidence collector's coverage step runs
//   npx vitest run --coverage --coverage.reporter=json --reporter=silent
// `--reporter=silent` is not a valid vitest reporter name on vitest 4.1.11 (and on
// the template's pinned ^3.0.0 → 3.2.7): vitest tries to `import('silent')` as a
// custom reporter module and aborts with a Startup Error, exit 1, before any test
// runs. Dropping `--reporter=silent` avoids the crash but then `--coverage.reporter
// =json` only writes coverage/coverage-final.json, never coverage-summary.json,
// which is the file `freshJson('coverage/coverage-summary.json', 'coverage')`
// reads. Either way the generated collector cannot ever record a coverage PASS.
//
// AC-1: the collector's coverage invocation on a real generated TS project
// produces coverage/coverage-summary.json and records coverage PASS when
// thresholds are met.
// AC-2: this test runs the REAL vitest (no shim) as a positive control.
import { describe, it, expect } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const REPO_NODE_MODULES = join(process.cwd(), 'node_modules')

function renderCollector(): string {
  const config = makeConfig('/tmp/test', { governanceLevel: 'L3', language: 'typescript' })
  return renderTemplate('scripts/evidence-collect.mjs.ejs', {
    ...(config as unknown as Record<string, unknown>),
    mutationThreshold: 80,
    coverageThreshold: 10, // low floor: only the plumbing is under test, not the ratchet
  })
}

describe('generated TS evidence collector: real coverage run (#2903)', () => {
  it('produces coverage-summary.json and records coverage PASS on a real vitest run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-ec-2903-'))
    try {
      symlinkSync(REPO_NODE_MODULES, join(dir, 'node_modules'))
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'ec-2903-fixture', version: '0.0.0', type: 'module' }, null, 2),
      )
      // cwd = temp dir with its own package.json/vitest.config.ts, so the child
      // vitest process must NOT pick up the repo's own vitest.config.ts.
      writeFileSync(
        join(dir, 'vitest.config.ts'),
        "import { defineConfig } from 'vitest/config'\n" +
          "export default defineConfig({ test: { coverage: { provider: 'v8', include: ['src/**'] } } })\n",
      )
      mkdirSync(join(dir, 'src'))
      writeFileSync(
        join(dir, 'src', 'add.ts'),
        'export const add = (a: number, b: number) => a + b\n',
      )
      writeFileSync(
        join(dir, 'src', 'add.test.ts'),
        "import { it, expect } from 'vitest'\n" +
          "import { add } from './add.js'\n" +
          "it('adds', () => expect(add(1, 2)).toBe(3))\n",
      )
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(join(dir, 'scripts', 'evidence-collect.mjs'), renderCollector())

      const run = spawnSync(process.execPath, [join(dir, 'scripts', 'evidence-collect.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, PATH: process.env.PATH ?? '' },
      })

      const summaryPath = join(dir, 'coverage', 'coverage-summary.json')
      expect(
        existsSync(summaryPath),
        `coverage-summary.json missing; collector stderr:\n${run.stderr}`,
      ).toBe(true)

      const evidence = JSON.parse(readFileSync(join(dir, '.evidence', 'SUMMARY.json'), 'utf-8'))
      // AC-1 is about the coverage dimension specifically: the collector must
      // read a real, freshly-written coverage-summary.json and record the
      // coverage sub-check as PASS (not fail-closed on a missing/stale report).
      // Unrelated dimensions (mutation/security tooling) are out of scope here.
      expect(
        evidence.failed_dimensions.some((d: string) => d.startsWith('coverage:')),
        `SUMMARY.json: ${JSON.stringify(evidence)}`,
      ).toBe(false)
      expect(evidence.coverage, `SUMMARY.json: ${JSON.stringify(evidence)}`).toEqual({
        line: 100,
        branch: 100,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
