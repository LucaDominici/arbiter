// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface WikiGeneratorResult {
  files: WriteResult[]
}

export function generateWiki(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): WikiGeneratorResult {
  // Wiki requires L2+ (L1 projects lack the docs/ corpus)
  if (config.governanceLevel === 'L1') {
    return { files: [] }
  }

  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'gen-wiki.mjs'),
      renderTemplate('scripts/gen-wiki.mjs.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-wiki-lint.mjs'),
      renderTemplate('scripts/check-wiki-lint.mjs.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // Only emit the Claude hook when not in ai-rulez brownfield mode (tool configs would be
  // skipped) AND the Claude tool track is actually enabled (#2257): this is a Claude Code
  // PostToolUse hook, invoked only through .claude/settings.json's dispatcher wiring, which
  // generateClaude() only emits when 'claude' is in config.tools. In codex-only mode the file
  // had no invocation path at all — dead on arrival, and check-hook-routing.mjs correctly
  // flagged it DEAD (wiki-on-commit.mjs has no Codex real-time equivalent by design; Codex
  // users get the wiki-lint gate check instead, see codex-known-limitations.ts).
  if (!config.existing.aiRulez && config.tools.includes('claude')) {
    results.push(
      writeFile(
        resolvedPath(base, '.claude', 'hooks', 'wiki-on-commit.mjs'),
        renderTemplate('claude/hooks/wiki-on-commit.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
