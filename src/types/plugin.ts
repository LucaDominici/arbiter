// SPDX-License-Identifier: Apache-2.0
import type { ArbiterConfig } from '../utils/config.js'
import type { VerifyPlanRule } from '../verify/rules/types.js'
import type { ArbiterMemoryPlugin } from './memory.js'

/**
 * @beta API is public but not stable. Breaking changes possible before v1.0.
 */
export interface ArbiterPlugin {
  name: string
  apiVersion: '1' // unchanged; worker isolation (#620) widens return types only
  templateRoot: string
  detect?(config: ArbiterConfig): boolean | Promise<boolean>
  generate(ctx: PluginContext): PluginResult | Promise<PluginResult>
  verifyPlanRules?: VerifyPlanRule[]
}

/**
 * @beta API is public but not stable. Breaking changes possible before v1.0.
 */
export interface PluginContext {
  config: ArbiterConfig
  targetDir: string
  renderTemplate(relPath: string, data: Record<string, unknown>): string
  /** Optional memory backend injected by the host when a memory plugin is configured. */
  memory?: ArbiterMemoryPlugin
}

/**
 * @beta API is public but not stable. Breaking changes possible before v1.0.
 */
export interface PluginFile {
  path: string
  content: string
  action?: 'create' | 'backup-and-replace' | 'skip'
}

/**
 * @beta API is public but not stable. Breaking changes possible before v1.0.
 */
export interface PluginResult {
  files: PluginFile[]
}
