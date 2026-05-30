// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { WriteResult } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'

export interface AgentFileGeneratorResult {
  files: WriteResult[]
}

/**
 * Build a generator for a single AGENTS.md-derived agent config file.
 *
 * Collapses the identical render→write body shared by the aider, copilot,
 * cursor, gemini, and windsurf generators, which differ only in their output
 * path and template path. `claude` and `codex` are intentionally NOT built
 * with this factory — they carry materially different logic.
 */
export function makeAgentFileGenerator(spec: {
  outPath: string[]
  templatePath: string
}): (config: ProjectConfig, opts?: { dryRun: boolean }) => AgentFileGeneratorResult {
  return (config, opts = { dryRun: false }) => ({
    files: [
      writeFile(
        resolvedPath(config.targetDir, ...spec.outPath),
        renderTemplate(spec.templatePath, config),
        { backup: true, dryRun: opts.dryRun },
      ),
    ],
  })
}
