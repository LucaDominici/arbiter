// SPDX-License-Identifier: Apache-2.0
/**
 * #1542 / #1523 — root cause of the "complexity collector returns 0" gotcha.
 *
 * `debt-lib`'s metric collector shells out and parses each tool's JSON from
 * stdout. The shared `run()` helper used the Node default `spawnSync` maxBuffer
 * of 1 MiB. The `eslint <paths> --format json` output for the repo exceeds 1 MiB,
 * so the child aborted with ENOBUFS, stdout was silently truncated to ~1 MiB, the
 * truncated JSON failed to parse, and the collector's catch fell back to a value
 * of 0 — i.e. the complexityViolations ratchet was vacuously comparing 0 vs 0 and
 * could never see a real regression. This guard asserts `run()` (via the exported
 * `spawnOrSkip`) returns the FULL output for >1 MiB payloads instead of aborting.
 */
import { describe, it, expect, vi } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { collectMetrics, spawnOrSkip } from '../../scripts/debt-lib.mjs'

const ROOT = join(__dirname, '..', '..')

describe('debt-lib spawnOrSkip — large-output buffering (#1542)', () => {
  it('returns the full child stdout for payloads larger than the 1 MiB default', () => {
    const bytes = 2_000_000
    const r = spawnOrSkip('probe', 'node', process.execPath, [
      '-e',
      `process.stdout.write('x'.repeat(${bytes}))`,
    ])
    expect(r).not.toBeNull()
    // Before the fix: status === null, error.code === 'ENOBUFS', stdout truncated.
    expect(r?.error).toBeUndefined()
    expect(r?.stdout.length).toBe(bytes)
  })
})

describe('debt-lib complexity ratchet scope (#1523/#1542)', () => {
  it('scans the scripts/ enforcement layer, not just src/', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'debt-lib.mjs'), 'utf8')
    // The complexityViolations collector must pass both paths so the gate code is
    // ratcheted alongside product code.
    expect(source).toMatch(/'eslint',\s*'src',\s*'scripts'/)
  })
})

function makeMetricsFixture(): { dir: string; binDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-debt-lib-2202-'))
  const binDir = join(dir, 'bin')
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(binDir)
  writeFileSync(join(dir, 'src', 'fixture.ts'), 'export const fixture = 1\n')
  writeFileSync(join(dir, '.jscpd.json'), JSON.stringify({ path: ['src'], reporters: ['json'] }))
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
  writeFileSync(join(binDir, 'grep'), '#!/bin/sh\nexit 1\n')
  chmodSync(join(binDir, 'npx'), 0o755)
  chmodSync(join(binDir, 'grep'), 0o755)
  return { dir, binDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function withPath<T>(path: string, fn: () => T, appendPrior = true): T {
  const prior = process.env.PATH
  process.env.PATH = appendPrior ? `${path}${delimiter}${prior ?? ''}` : path
  try {
    return fn()
  } finally {
    process.env.PATH = prior
  }
}

describe('debt-lib collection failures (#2202)', () => {
  it('omits coverage and reports a collection error when vitest ran without a coverage summary', () => {
    const { dir, binDir, cleanup } = makeMetricsFixture()
    try {
      const errors: Array<{ metric: string; reason: string }> = []

      const metrics = withPath(binDir, () => collectMetrics(dir, errors))

      expect(metrics.coverageLine).toBeUndefined()
      expect(errors).toContainEqual(expect.objectContaining({ metric: 'coverageLine' }))
    } finally {
      cleanup()
    }
  })

  it('soft-skips vitest when npx is not installed without recording a collection error', () => {
    const { dir, cleanup } = makeMetricsFixture()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const errors: Array<{ metric: string; reason: string }> = []
      // Deliberately omit npx from PATH while retaining grep for the independent
      // public-API scan and direct jscpd execution.
      const noNpxDir = join(dir, 'no-npx')
      mkdirSync(noNpxDir)
      writeFileSync(join(noNpxDir, 'grep'), '#!/bin/sh\nexit 1\n')
      chmodSync(join(noNpxDir, 'grep'), 0o755)

      const metrics = withPath(noNpxDir, () => collectMetrics(dir, errors), false)

      expect(metrics.coverageLine).toBeUndefined()
      expect(errors).not.toContainEqual(expect.objectContaining({ metric: 'coverageLine' }))
      expect(stderr).toHaveBeenCalledWith('[baseline] skip coverageLine — vitest not installed\n')
    } finally {
      stderr.mockRestore()
      cleanup()
    }
  })

  it('soft-skips vitest when npx reports missing packages without recording a collection error', () => {
    const { dir, binDir, cleanup } = makeMetricsFixture()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      writeFileSync(
        join(binDir, 'npx'),
        '#!/bin/sh\necho "npm error npx canceled due to missing packages and no YES option" 1>&2\nexit 1\n',
      )
      chmodSync(join(binDir, 'npx'), 0o755)
      const errors: Array<{ metric: string; reason: string }> = []

      const metrics = withPath(binDir, () => collectMetrics(dir, errors))

      expect(metrics.coverageLine).toBeUndefined()
      expect(metrics.coverageBranch).toBeUndefined()
      expect(errors).not.toContainEqual(expect.objectContaining({ metric: 'coverageLine' }))
      expect(stderr).toHaveBeenCalledWith('[baseline] skip coverageLine — vitest not installed\n')
    } finally {
      stderr.mockRestore()
      cleanup()
    }
  })
})

// ─── Injectable coverage spawn seam (#2226) ───────────────────────────────────
// The Debt Ratchet's ENOENT (`vitest coverage summary unreadable: ... .coverage-tmp/
// coverage-summary.json`) was CI-only and NOT reproducible locally — the coverage
// path in collectMetrics had no injection seam, so a unit test could not simulate
// "vitest ran but wrote no summary" / "vitest exited 1 with a provider error"
// deterministically. Mirror jscpdScan's `opts.spawn` seam: `opts.spawnCoverage`
// replaces the `npx vitest run --coverage` invocation, and the enriched diagnostic
// names the real cause from the run's own stdout/stderr instead of a bare ENOENT.
describe('debt-lib coverage collection — injectable spawn seam (#2226)', () => {
  it('uses the injected spawn; shim exits 0 writing no summary → collection error, no coverage metric', () => {
    const { dir, binDir, cleanup } = makeMetricsFixture()
    try {
      const shim = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
      const errors: Array<{ metric: string; reason: string }> = []

      const metrics = withPath(binDir, () => collectMetrics(dir, errors, { spawnCoverage: shim }))

      // Before the seam (#2226) the third arg was ignored and the shim never ran.
      expect(shim).toHaveBeenCalled()
      expect(metrics.coverageLine).toBeUndefined()
      expect(errors).toContainEqual(expect.objectContaining({ metric: 'coverageLine' }))
    } finally {
      cleanup()
    }
  })

  it('enriched reason names the failing test, vitest version, provider error and .coverage-tmp probe', () => {
    const { dir, binDir, cleanup } = makeMetricsFixture()
    try {
      const shim = vi.fn(() => ({
        status: 1,
        stdout:
          'RUN v4.1.10 /tmp/runner/work/arbiter/arbiter\n\nFailed Tests: 1\nverify-commands.test.ts > verify tdd #551',
        stderr: 'Error: coverage provider v8 failed to start',
      }))
      const errors: Array<{ metric: string; reason: string }> = []

      withPath(binDir, () => collectMetrics(dir, errors, { spawnCoverage: shim }))

      const entry = errors.find((e) => e.metric === 'coverageLine')
      expect(entry).toBeDefined()
      // The stderr-only tail once captured a PASSING test's incidental stderr and
      // misled the wave-1 diagnosis (#2226) — the real cause lives in stdout.
      expect(entry?.reason).toContain('verify-commands.test.ts')
      expect(entry?.reason).toContain('v4.1.10')
      expect(entry?.reason).toContain('coverage provider v8 failed to start')
      expect(entry?.reason).toContain('.coverage-tmp NOT created')
    } finally {
      cleanup()
    }
  })
})
