// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface SsotGeneratorResult {
  files: WriteResult[]
}

export function generateSsot(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): SsotGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config

  // SSOT_CORE_SET.md — always generated (authoritative doc inventory)
  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'METHOD', 'SSOT_CORE_SET.md'),
      renderTemplate('root/docs/METHOD/SSOT_CORE_SET.md.ejs', data),
      { backup: true, dryRun: opts.dryRun },
    ),
  )

  // KNOWLEDGE_MAP.md — skipIfExists: it accumulates manual line-range edits over time
  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'METHOD', 'KNOWLEDGE_MAP.md'),
      renderTemplate('root/docs/METHOD/KNOWLEDGE_MAP.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // ENGINEERING_DEFAULTS.md — L2 and above only
  if (config.governanceLevel !== 'L1') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'METHOD', 'ENGINEERING_DEFAULTS.md'),
        renderTemplate('root/docs/METHOD/ENGINEERING_DEFAULTS.md.ejs', data),
        { backup: true, dryRun: opts.dryRun },
      ),
    )

    // REUSE_REGISTRY_SPEC.md — L2+: the CANON-16 existing-code survey spec (#2079).
    // Fixed spec doc → backup:true, regenerated like ENGINEERING_DEFAULTS.
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'METHOD', 'REUSE_REGISTRY_SPEC.md'),
        renderTemplate('root/docs/METHOD/REUSE_REGISTRY_SPEC.md.ejs', data),
        { backup: true, dryRun: opts.dryRun },
      ),
    )

    // PATTERNS_CATALOG.md — L2+: the consumer-populated pattern register (#2079).
    // skipIfExists so `arbiter update` never clobbers catalogued entries (KNOWLEDGE_MAP precedent).
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'METHOD', 'PATTERNS_CATALOG.md'),
        renderTemplate('root/docs/METHOD/PATTERNS_CATALOG.md.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // TRACK_ROUTER.md — L4 only (compliance-grade context economy)
  if (config.governanceLevel === 'L4') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'METHOD', 'TRACK_ROUTER.md'),
        renderTemplate('root/docs/METHOD/TRACK_ROUTER.md.ejs', data),
        { backup: true, dryRun: opts.dryRun },
      ),
    )
  }

  // CANONICAL_PATHS.md — all levels; skipIfExists so user alias entries are preserved (#255)
  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'METHOD', 'CANONICAL_PATHS.md'),
      renderTemplate('root/docs/METHOD/CANONICAL_PATHS.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // SSOT gate scripts — emitted alongside the SSOT pillar docs they verify (#255)
  const ssotScripts = [
    'check-ssot-core',
    'check-doc-links',
    'check-knowledge-map',
    'check-canonical-paths',
    'knowledge-map-update',
  ] as const

  for (const name of ssotScripts) {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', `${name}.mjs`),
        renderTemplate(`scripts/${name}.mjs.ejs`, data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
