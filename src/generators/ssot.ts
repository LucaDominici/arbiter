import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface SsotGeneratorResult {
  files: WriteResult[]
}

export function generateSsot(config: ProjectConfig): SsotGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config

  // SSOT_CORE_SET.md — always generated (authoritative doc inventory)
  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'METHOD', 'SSOT_CORE_SET.md'),
      renderTemplate('root/docs/METHOD/SSOT_CORE_SET.md.ejs', data),
      { backup: true },
    ),
  )

  // KNOWLEDGE_MAP.md — skipIfExists: it accumulates manual line-range edits over time
  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'METHOD', 'KNOWLEDGE_MAP.md'),
      renderTemplate('root/docs/METHOD/KNOWLEDGE_MAP.md.ejs', data),
      { skipIfExists: true },
    ),
  )

  // ENGINEERING_DEFAULTS.md — L2 and above only
  if (config.governanceLevel !== 'L1') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'METHOD', 'ENGINEERING_DEFAULTS.md'),
        renderTemplate('root/docs/METHOD/ENGINEERING_DEFAULTS.md.ejs', data),
        { backup: true },
      ),
    )
  }

  // TRACK_ROUTER.md — L3 only (full enterprise context economy)
  if (config.governanceLevel === 'L3') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'METHOD', 'TRACK_ROUTER.md'),
        renderTemplate('root/docs/METHOD/TRACK_ROUTER.md.ejs', data),
        { backup: true },
      ),
    )
  }

  // CANONICAL_PATHS.md — all levels; skipIfExists so user alias entries are preserved (#255)
  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'METHOD', 'CANONICAL_PATHS.md'),
      renderTemplate('root/docs/METHOD/CANONICAL_PATHS.md.ejs', data),
      { skipIfExists: true },
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
        { skipIfExists: true },
      ),
    )
  }

  // harness.mjs — convenience runner for all four SSOT gates (#255)
  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'harness.mjs'),
      renderTemplate('scripts/harness.mjs.ejs', data),
      { skipIfExists: true },
    ),
  )

  return { files: results }
}
