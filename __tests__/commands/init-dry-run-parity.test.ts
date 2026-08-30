// SPDX-License-Identifier: Apache-2.0
//
// #2434 — two claims init makes about itself that were false:
//   A. `SECURITY.md` / `.editorconfig` are documented as "baseline repo hygiene",
//      yet the whole `root` generator was gated on `permitGitHub ?? useGitHub`, so
//      a default init emitted neither. Only the `.github/`-bound file in that
//      generator (CODEOWNERS) has anything to do with GitHub permission.
//   D. `--dry-run` printed the migration plan alone (3 entries) while the real run
//      wrote 271 files — the preview structurally could not name generator output.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { buildRegistry, runGeneratorsFromRegistry } from '../../src/generators/registry.js'
import type { GeneratorSpec } from '../../src/generators/registry.js'
import { computeDryRunPreview } from '../../src/commands/init.js'
import type { ProjectConfig } from '../../src/wizard/types.js'
import { makeConfig } from '../helpers.js'

function scaffoldBareTs(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'dry-run-fixture', version: '1.0.0', private: true }, null, 2)}\n`,
  )
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const answer = 42\n')
}

function rel(dir: string, path: string): string {
  return relative(dir, path).split(sep).join('/')
}

function rootSpec(config: ProjectConfig): GeneratorSpec {
  const spec = buildRegistry(config).find((s) => s.key === 'root')
  if (spec === undefined) throw new Error('root generator spec missing from the registry')
  return spec
}

function rootPaths(config: ProjectConfig): string[] {
  return runGeneratorsFromRegistry([rootSpec(config)], [], { dryRun: true }).map((r) =>
    rel(config.targetDir, r.path),
  )
}

describe('#2434 A — the root generator is gated per file, not wholesale', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-2434-root-'))
    scaffoldBareTs(dir)
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits the baseline hygiene files when GitHub is NOT permitted', () => {
    const config = makeConfig(dir, { useGitHub: false, permitGitHub: false })
    expect(rootSpec(config).enabled).toBe(true)
    const paths = rootPaths(config)
    expect(paths).toContain('SECURITY.md')
    expect(paths).toContain('.editorconfig')
    expect(paths).toContain('CONTRIBUTING.md')
  })

  it('withholds .github/CODEOWNERS when GitHub is NOT permitted', () => {
    const config = makeConfig(dir, {
      useGitHub: false,
      permitGitHub: false,
      githubOwner: 'acme',
      githubRepo: 'widget',
    })
    expect(rootPaths(config)).not.toContain('.github/CODEOWNERS')
  })

  it('still emits .github/CODEOWNERS when GitHub IS permitted', () => {
    const config = makeConfig(dir, {
      useGitHub: true,
      permitGitHub: true,
      githubOwner: 'acme',
      githubRepo: 'widget',
    })
    expect(rootPaths(config)).toContain('.github/CODEOWNERS')
  })
})

describe('#2434 D — --dry-run names every file the real run writes', () => {
  let previewDir: string
  let realDir: string
  beforeEach(() => {
    previewDir = mkdtempSync(join(tmpdir(), 'arbiter-2434-preview-'))
    realDir = mkdtempSync(join(tmpdir(), 'arbiter-2434-real-'))
    scaffoldBareTs(previewDir)
    scaffoldBareTs(realDir)
  })
  afterEach(() => {
    rmSync(previewDir, { recursive: true, force: true })
    rmSync(realDir, { recursive: true, force: true })
  })

  it('the preview is a superset of the paths a real registry run writes', () => {
    const written = runGeneratorsFromRegistry(buildRegistry(makeConfig(realDir)), [], {
      dryRun: false,
    })
      .filter((r) => r.action !== 'skipped')
      .map((r) => rel(realDir, r.path))
    expect(written.length).toBeGreaterThan(100)

    const preview = computeDryRunPreview(makeConfig(previewDir))
    const previewed = new Set([...preview.created, ...preview.modified])
    expect(written.filter((p) => !previewed.has(p))).toEqual([])
  })

  it('keeps the #540 brownfield consent narrative from the migration plan', () => {
    const preview = computeDryRunPreview(
      makeConfig(previewDir, {
        existing: { ...makeConfig(previewDir).existing, claudeDir: true, settingsJson: true },
      }),
    )
    expect(preview.modified.some((s) => s.includes('deep-merged'))).toBe(true)
    expect(preview.skipped.some((s) => s.includes('hooks'))).toBe(true)
  })

  it('writes nothing to disk', () => {
    computeDryRunPreview(makeConfig(previewDir))
    expect(readdirSync(previewDir).sort()).toEqual(['package.json', 'src'])
  })
})
