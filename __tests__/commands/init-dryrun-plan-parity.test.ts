// SPDX-License-Identifier: Apache-2.0
//
// #2452 — `init --dry-run` must preview what the real generator run would ACTUALLY
// write and skip. Before this issue the preview came from `buildMigrationPlan`, a
// hand-maintained ~8-path stub unrelated to the generator registry: on a brownfield Go
// fixture it named 3 directory-blob pseudo-paths while the real run created 252 files
// and skipped 3 by name (.gitignore, .golangci.yml, Makefile).
//
// The relationship pinned here is PREVIEW == PLAN, never a file count — a template
// added tomorrow moves both sides at once and these tests stay green.
import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { computeDryRunPreview, executeInitGeneration } from '../../src/commands/init/generate.js'
import { runGeneratorsSelective } from '../../src/generators/registry.js'
import type { GeneratorSpec } from '../../src/generators/registry.js'
import type { GeneratorKey } from '../../src/config/diff.js'
import { getLanguageHooks } from '../../src/detectors/language-hooks.js'
import type { WriteResult } from '../../src/utils/fs.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

/**
 * The ONE class of generator a fresh dry run cannot speak for: `doc-set-skeletons`
 * reads the gold-kit manifest that the `gold-kit` generator emits moments earlier in
 * the SAME run (src/generators/registry.ts, src/generators/doc-set.ts §1.2e), so before
 * the run there is nothing on disk for it to resolve and it honestly emits nothing.
 *
 * This list is the only literal in the file. Every other generator must preview
 * exactly what it writes, and the last assertion below fails if this exception ever
 * goes stale (the excluded generator stops diverging) — so the list cannot quietly
 * absorb a NEW divergence, in either direction.
 */
const SECOND_ORDER_GENERATOR_KEYS: readonly GeneratorKey[] = ['doc-set-skeletons']

/** Pre-existing files a wary brownfield adopter expects arbiter to leave alone. */
const PRE_EXISTING = {
  '.gitignore': 'vendor/\n',
  '.golangci.yml': 'linters:\n  enable:\n    - govet\n',
  Makefile: 'build:\n\tgo build ./...\n',
}

const created: string[] = []

function seedBrownfieldGoProject(): string {
  const dir = createTestProject('go')
  initGit(dir)
  for (const [name, body] of Object.entries(PRE_EXISTING)) {
    writeFileSync(join(dir, name), body)
  }
  created.push(dir)
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

/**
 * targetDir-relative paths of everything a run touched. `not-applicable` results are
 * dropped for the same reason the preview drops them (#1491): they were deliberately
 * never emitted, so neither side should claim them.
 */
function touchedPaths(results: WriteResult[], dir: string): string[] {
  return results
    .filter((r) => r.reason !== 'not-applicable')
    .map((r) => relative(dir, r.path))
    .sort()
}

/** Every path the preview names, across all three buckets. */
function previewPaths(preview: {
  created: string[]
  modified: string[]
  skipped: string[]
}): string[] {
  return [...preview.created, ...preview.modified, ...preview.skipped].sort()
}

function firstOrderKeys(specs: GeneratorSpec[]): Set<GeneratorKey | '*'> {
  const keys: Set<GeneratorKey | '*'> = new Set()
  for (const spec of specs) {
    if (!SECOND_ORDER_GENERATOR_KEYS.includes(spec.key)) keys.add(spec.key)
  }
  return keys
}

describe('#2452 — init --dry-run previews the plan the real run executes', () => {
  afterEach(() => {
    while (created.length > 0) cleanupTestProject(created.pop() as string)
  })

  it('AC-1: the preview path set equals what the real run writes and skips', async () => {
    const dir = seedBrownfieldGoProject()
    const config = goConfig(dir)

    // A dry run has no side effects, so the real run below still starts from the
    // untouched brownfield tree.
    const preview = await computeDryRunPreview(config)
    const plan = await executeInitGeneration({ config, targetDir: dir, dryRun: true })

    // The SAME spec list, executed for real. Only the second-order generator is held
    // back — see SECOND_ORDER_GENERATOR_KEYS.
    const real = runGeneratorsSelective(plan.specs, firstOrderKeys(plan.specs), [], {
      dryRun: false,
    })

    expect(previewPaths(preview).length).toBeGreaterThan(0)
    expect(previewPaths(preview)).toEqual(touchedPaths(real, dir))
  }, 120_000)

  it('AC-1: every brownfield skip-if-exists the real run performs is named in the preview', async () => {
    const dir = seedBrownfieldGoProject()
    const config = goConfig(dir)

    const preview = await computeDryRunPreview(config)
    const real = await executeInitGeneration({ config, targetDir: dir, dryRun: false })

    const reallySkipped = touchedPaths(
      real.results.filter((r) => r.action === 'skipped'),
      dir,
    )

    expect(real.errors).toEqual([])
    expect(reallySkipped).toContain('.gitignore')
    for (const skipped of reallySkipped) {
      expect(preview.skipped).toContain(skipped)
    }
  }, 120_000)

  it('AC-1: the preview is a projection of the plan, not a parallel stub', async () => {
    const dir = seedBrownfieldGoProject()
    const config = goConfig(dir)

    const preview = await computeDryRunPreview(config)
    const dry = await executeInitGeneration({ config, targetDir: dir, dryRun: true })

    expect(previewPaths(preview)).toEqual(touchedPaths(dry.results, dir))
  }, 120_000)

  it('AC-1: the second-order exception is live, not a stale escape hatch', async () => {
    const dir = seedBrownfieldGoProject()
    const config = goConfig(dir)

    const preview = new Set(previewPaths(await computeDryRunPreview(config)))
    const full = await executeInitGeneration({ config, targetDir: dir, dryRun: false })

    // Whatever the full run touches beyond the preview must be exactly the excluded
    // generators' doing. If that difference ever empties out, the exclusion list above
    // is stale and must shrink; if it grows a path from another generator, the preview
    // has started lying again and this fails.
    const unpreviewed = touchedPaths(full.results, dir).filter((p) => !preview.has(p))
    expect(unpreviewed.length).toBeGreaterThan(0)
  }, 120_000)
})
