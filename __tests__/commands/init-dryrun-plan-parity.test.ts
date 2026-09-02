// SPDX-License-Identifier: Apache-2.0
//
// #2452 — `init --dry-run` must preview what the real generator run would ACTUALLY
// write and skip. Before this issue the preview came from `buildMigrationPlan`, a
// hand-maintained ~8-path stub unrelated to the generator registry: on a brownfield Go
// fixture it named 3 directory-blob pseudo-paths while the real run created 252 files
// and skipped 3 by name.
//
// The relationship pinned here is PREVIEW == PLAN, never a file count — a template
// added tomorrow moves both sides at once and these tests stay green.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { computeDryRunPreview, executeInitGeneration } from '../../src/commands/init/generate.js'
import { buildRegistry, runGeneratorsSelective } from '../../src/generators/registry.js'
import { getLanguageHooks } from '../../src/detectors/language-hooks.js'
import type { WriteResult } from '../../src/utils/fs.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

/**
 * Generators whose emission depends on an artifact the SAME run writes earlier, so a
 * fresh dry run (nothing on disk yet) honestly emits nothing for them:
 * `doc-set-skeletons` reads the gold-kit manifest that the `gold-kit` generator emits
 * moments before it (src/generators/registry.ts, src/generators/doc-set.ts §1.2e).
 * The test computes their PATHS dynamically — the key list is the only literal, so a
 * NEW divergence between preview and real run fails here instead of being absorbed.
 */
const SECOND_ORDER_GENERATOR_KEYS = ['doc-set-skeletons'] as const

/** Pre-existing files a wary brownfield adopter expects arbiter to leave alone. */
const PRE_EXISTING = {
  '.gitignore': 'vendor/\n',
  '.golangci.yml': 'linters:\n  enable:\n    - govet\n',
  Makefile: 'build:\n\tgo build ./...\n',
}

function seedBrownfieldGoProject(): string {
  const dir = createTestProject('go')
  initGit(dir)
  for (const [name, body] of Object.entries(PRE_EXISTING)) {
    writeFileSync(join(dir, name), body)
  }
  return dir
}

function goConfig(dir: string): ProjectConfig {
  return makeConfig(dir, {
    language: 'go',
    buildTool: 'go',
    buildCommand: 'go build ./...',
    testCommand: 'go test ./...',
    lintCommand: 'golangci-lint run',
    formatCommand: 'gofmt -l .',
    languageHooks: getLanguageHooks('go'),
    governanceLevel: 'L2',
    useGitHub: false,
  })
}

function relPaths(results: WriteResult[], dir: string): string[] {
  return results.map((r) => relative(dir, r.path))
}

/** Every path the preview names, across all three buckets. */
function previewPaths(preview: {
  created: string[]
  modified: string[]
  skipped: string[]
}): Set<string> {
  return new Set([...preview.created, ...preview.modified, ...preview.skipped])
}

/**
 * Paths contributed by the second-order generators, resolved against a directory where
 * the real run has already landed (so their input artifact exists). Dry, never writes.
 */
function secondOrderPaths(config: ProjectConfig, dir: string): Set<string> {
  const results = runGeneratorsSelective(
    buildRegistry(config, []),
    new Set(SECOND_ORDER_GENERATOR_KEYS),
    [],
    { dryRun: true },
  )
  return new Set(relPaths(results, dir))
}

describe('#2452 — init --dry-run previews the plan the real run executes', () => {
  let dir: string

  beforeEach(() => {
    dir = seedBrownfieldGoProject()
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('AC-1: the preview path set equals the real generator run path set', async () => {
    const config = goConfig(dir)

    // Preview first — a dry run has no side effects, so the real run below still sees
    // the untouched brownfield tree.
    const preview = await computeDryRunPreview(config)
    const previewed = previewPaths(preview)

    const real = await executeInitGeneration({ config, targetDir: dir, dryRun: false })
    const realPaths = new Set(
      relPaths(
        real.results.filter((r) => r.reason !== 'not-applicable'),
        dir,
      ),
    )

    expect(real.errors).toEqual([])
    expect(previewed.size).toBeGreaterThan(0)

    // The preview never invents a path the run does not touch.
    expect([...previewed].filter((p) => !realPaths.has(p)).sort()).toEqual([])

    // …and never hides one, except the documented second-order generators.
    const expectedGap = secondOrderPaths(config, dir)
    expect([...realPaths].filter((p) => !previewed.has(p)).sort()).toEqual(
      [...expectedGap].filter((p) => realPaths.has(p)).sort(),
    )
  })

  it('AC-1: every brownfield skip-if-exists the real run performs is named in the preview', async () => {
    const config = goConfig(dir)

    const preview = await computeDryRunPreview(config)
    const real = await executeInitGeneration({ config, targetDir: dir, dryRun: false })

    const reallySkipped = relPaths(
      real.results.filter((r) => r.action === 'skipped' && r.reason !== 'not-applicable'),
      dir,
    )

    expect(reallySkipped.length).toBeGreaterThan(0)
    expect(reallySkipped).toContain('.gitignore')
    for (const skipped of reallySkipped) {
      expect(preview.skipped).toContain(skipped)
    }
  })

  it('AC-1: the preview is a projection of the plan executed with dryRun, not a parallel stub', async () => {
    const config = goConfig(dir)

    const preview = await computeDryRunPreview(config)
    const dry = await executeInitGeneration({ config, targetDir: dir, dryRun: true })

    const planned = new Set(
      relPaths(
        dry.results.filter((r) => r.reason !== 'not-applicable'),
        dir,
      ),
    )
    expect([...previewPaths(preview)].sort()).toEqual([...planned].sort())
  })
})
