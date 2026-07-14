// SPDX-License-Identifier: Apache-2.0
// #1950 — generated Go debt collector must exclude npm packages that ship Go
// source without a nested go.mod (e.g. `flatted`) from coverage, so the debt
// ratchet is not dependency-layout-sensitive. Renders the Go debt-lib.mjs.ejs
// template, materializes a real Go module with a `node_modules/flatted/...`
// Go package (no nested go.mod, mirroring the reproduction in #1950), then
// drives the generated `collectMetrics` and asserts the coverprofile holds no
// node_modules import path. Runs under the nightly generated-gate-e2e job
// (VITEST_L2=1) where Go is installed; SKIPs with a reason where Go is absent.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { describe, it, expect } from 'vitest'

import { renderTemplate } from '../../../../src/utils/render.js'
import { makeConfig } from '../../../helpers.js'
import { computeMetricsProfile } from '../../../../src/generators/debt-ratchet.js'

const L2 = process.env.VITEST_L2 === '1'

function hasBinary(bin: string): boolean {
  const r = spawnSync('which', [bin], { encoding: 'utf-8' })
  return r.status === 0 && r.stdout.trim().length > 0
}

describe.skipIf(!L2)('generated Go debt collector excludes node_modules (#1950)', () => {
  it.skipIf(!hasBinary('go'))(
    'coverprofile holds no /node_modules/ import path when flatted ships Go source',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'go-debt-1950-'))
      try {
        // Minimal Go module + a passing test so `go test -coverprofile` runs.
        spawnSync('go', ['mod', 'init', 'example.com/probe-1950'], {
          cwd: dir,
          encoding: 'utf-8',
        })
        writeFileSync(join(dir, 'main.go'), 'package main\n\nfunc main() {}\n')
        writeFileSync(
          join(dir, 'main_test.go'),
          'package main\n\nimport "testing"\n\nfunc TestNoop(t *testing.T) {}\n',
        )
        // flatted-style npm package that ships Go source without a nested
        // go.mod — exactly the reproduction from #1950.
        const flattedDir = join(dir, 'node_modules', 'flatted', 'golang', 'pkg', 'flatted')
        mkdirSync(flattedDir, { recursive: true })
        writeFileSync(
          join(flattedDir, 'flatted.go'),
          'package flatted\n\n// Encode is a vendored npm shim, not project code.\nfunc Encode(in any) any { return in }\n',
        )

        // Render the Go debt-lib.mjs into the temp project + stub the only
        // relative dependency (glob-walk) so the rendered module imports cleanly.
        const config = makeConfig(dir, { language: 'go', enableDebtGates: true })
        const data = {
          ...config,
          metricsProfile: computeMetricsProfile(config),
        } as unknown as Record<string, unknown>
        const rendered = renderTemplate('scripts/debt-lib.mjs.ejs', data)
        const scriptsDir = join(dir, 'scripts')
        const libDir = join(scriptsDir, 'lib')
        mkdirSync(libDir, { recursive: true })
        writeFileSync(join(scriptsDir, 'debt-lib.mjs'), rendered)
        writeFileSync(join(libDir, 'glob-walk.mjs'), 'export function walkRepo() { return [] }\n')

        const modUrl = pathToFileURL(join(scriptsDir, 'debt-lib.mjs')).href
        const mod = (await import(modUrl)) as {
          collectMetrics: (cwd: string) => Record<string, unknown>
        }
        // Should not throw — enumeration succeeds and yields the main package.
        const metrics = mod.collectMetrics(dir)
        expect(metrics.coverageLine).toBeDefined()

        // The load-bearing #1950 assertion: the generated coverprofile must
        // not contain any node_modules import path. With bare `./...` it would
        // include `example.com/probe-1950/node_modules/flatted/...`.
        const coverPath = join(dir, '.coverage-tmp.out')
        expect(existsSync(coverPath), 'go test -coverprofile produced a coverprofile').toBe(true)
        const cover = readFileSync(coverPath, 'utf-8')
        expect(cover).not.toMatch(/\/node_modules\//)
        // And the project's own package must still be measured.
        expect(cover).toContain('example.com/probe-1950')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    120_000,
  )
})
