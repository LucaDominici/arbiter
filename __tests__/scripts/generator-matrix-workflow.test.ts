// SPDX-License-Identifier: Apache-2.0
// F4 / #1840 tranche 2 — contract test for .github/workflows/generator-matrix.yml.
//
// The workflow is hand-authored (not `.ejs`-rendered), so it is outside the reach of
// __tests__/templates/_nightly-render.test.ts. This test locks two things that test
// suite's own history proves regress silently:
//   1. the three decided triggers (dispatchable + weekly + pre-release, #1840 tranche-2
//      decision comment) stay wired;
//   2. the closed 5-cell list (TS packaged-artifact; Python/Go/Rust/Java
//      fixture-functional; Kotlin excluded) stays exactly as decided — no silent drift
//      in either direction;
//   3. the Go toolchain pin this workflow installs stays satisfied by the go-library
//      fixture's `go` directive (the #1854/#1856 toolchain-pin incident class — same
//      MIN_GO_FOR_PINNED_TOOL registry the _nightly.yml.ejs guard uses).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  extractGoInstallPins,
  assertGoPinsSatisfyDirective,
} from '../helpers/go-pinned-tool-minimums.js'

const WORKFLOW_PATH = resolve('.github/workflows/generator-matrix.yml')

function readWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf-8')
}

describe('.github/workflows/generator-matrix.yml — trigger contract (#1840 tranche 2)', () => {
  it('is workflow_dispatch-able', () => {
    expect(readWorkflow()).toMatch(/^\s*workflow_dispatch:\s*$/m)
  })

  it('runs on a weekly schedule', () => {
    expect(readWorkflow()).toMatch(/^\s*schedule:\s*$/m)
    expect(readWorkflow()).toContain("cron: '0 5 * * 0'")
  })

  it('runs on pre-release (release: types: [prereleased])', () => {
    const rendered = readWorkflow()
    expect(rendered).toMatch(/^\s*release:\s*$/m)
    expect(rendered).toContain('types: [prereleased]')
  })
})

describe('.github/workflows/generator-matrix.yml — closed 5-cell list (#1840 tranche 2 decision)', () => {
  const rendered = readWorkflow()

  it('includes exactly the 5 decided stacks in the matrix', () => {
    const stacks = [...rendered.matchAll(/^\s*- stack: (\w+)$/gm)].map((m) => m[1])
    expect(stacks.sort()).toEqual(['go', 'java', 'python', 'rust', 'typescript'].sort())
  })

  it('typescript cell runs packaged-artifact.test.ts (not the plain fixture-functional cell)', () => {
    expect(rendered).toContain(
      'vitestArgs: __tests__/integration/e2e/functional/packaged-artifact.test.ts',
    )
  })

  it.each(['python', 'go', 'rust', 'java'])(
    '%s cell runs fixture-functional.test.ts -t %s',
    (stack) => {
      expect(rendered).toContain(
        `vitestArgs: __tests__/integration/e2e/functional/fixture-functional.test.ts -t ${stack}`,
      )
    },
  )

  it('does NOT include a kotlin cell (declassified to snapshot-only, decision #2)', () => {
    expect(rendered).not.toMatch(/^\s*- stack: kotlin$/m)
  })

  it('runs every cell behind VITEST_L2=1 (the DEEP-tier gate)', () => {
    expect(rendered).toContain("VITEST_L2: '1'")
  })
})

describe('.github/workflows/generator-matrix.yml — Go toolchain satisfies pinned tool (#1854/#1856 class)', () => {
  it('go-library fixture go directive satisfies every go install pin in this workflow', () => {
    const rendered = readWorkflow()
    const pins = extractGoInstallPins(rendered)
    expect(pins.length, 'expected at least one pinned go install line').toBeGreaterThan(0)

    const goModPath = resolve('__tests__/fixtures/real-projects/go-library/go.mod')
    const goModContent = readFileSync(goModPath, 'utf-8')
    expect(() => assertGoPinsSatisfyDirective(pins, goModContent)).not.toThrow()
  })

  it('go setup step points at the go-library fixture (version-file and cache path aligned)', () => {
    const rendered = readWorkflow()
    const versionFileCount = (
      rendered.match(/go-version-file: __tests__\/fixtures\/real-projects\/go-library\/go\.mod/g) ??
      []
    ).length
    const cachePathCount = (
      rendered.match(
        /cache-dependency-path: __tests__\/fixtures\/real-projects\/go-library\/go\.mod/g,
      ) ?? []
    ).length
    expect(versionFileCount).toBeGreaterThan(0)
    expect(cachePathCount).toBe(versionFileCount)
  })
})

describe('.github/workflows/generator-matrix.yml — living examples drift step (#1840 F4 tranche 4)', () => {
  it('runs the examples drift check scoped to the cell stack', () => {
    const rendered = readWorkflow()
    expect(rendered).toContain(
      'node scripts/regenerate-examples.mjs --check --stack=${{ matrix.stack }}',
    )
  })

  it('gates the drift step to exactly the 3 README-supported (GA) stacks', () => {
    const rendered = readWorkflow()
    const stepMatch = rendered.match(/- name: Living examples drift[^\n]*\n\s*if: ([^\n]+)\n/)
    expect(
      stepMatch,
      'expected a "Living examples drift" step with an if: condition',
    ).not.toBeNull()
    const condition = stepMatch?.[1] ?? ''
    for (const stack of ['typescript', 'python', 'go']) {
      expect(condition).toContain(`matrix.stack == '${stack}'`)
    }
    // Rust/Java have no living example (declared "Experimental" in README §Stack
    // support) — the condition must not silently widen to cover them.
    for (const stack of ['rust', 'java']) {
      expect(condition).not.toContain(`matrix.stack == '${stack}'`)
    }
  })
})
