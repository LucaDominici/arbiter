import type { ArbiterConfigV2 } from '../config/schema.js'
import type { DecompositionBackend } from './types.js'
import { GitHubBackend } from './github-backend.js'
import { MarkdownBackend } from './markdown-backend.js'

export function getBackend(config: ArbiterConfigV2, projectDir?: string): DecompositionBackend {
  const backendId = config.decomposition?.backend ?? (config.useGitHub ? 'github' : 'markdown')

  switch (backendId) {
    case 'github':
      return new GitHubBackend(config)
    case 'markdown':
      return new MarkdownBackend(config, projectDir)
    default:
      throw new Error(
        `Unknown decomposition backend: "${String(backendId)}". Valid values: github, markdown`,
      )
  }
}
