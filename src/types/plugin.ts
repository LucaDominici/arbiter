import type { ArbiterConfig } from "../utils/config.js";
import type { VerifyPlanRule } from "../verify/rules/types.js";

/**
 * @beta API is public but not stable. Breaking changes possible before v1.0.
 */
export interface ArbiterPlugin {
  name: string;
  apiVersion: "1";
  templateRoot: string;
  detect?(config: ArbiterConfig): boolean;
  generate(ctx: PluginContext): PluginResult;
  verifyPlanRules?: VerifyPlanRule[];
}

/**
 * @beta API is public but not stable. Breaking changes possible before v1.0.
 */
export interface PluginContext {
  config: ArbiterConfig;
  targetDir: string;
  renderTemplate(relPath: string, data: Record<string, unknown>): string;
}

/**
 * @beta API is public but not stable. Breaking changes possible before v1.0.
 */
export interface PluginFile {
  path: string;
  content: string;
  action?: "create" | "backup-and-replace" | "skip";
}

/**
 * @beta API is public but not stable. Breaking changes possible before v1.0.
 */
export interface PluginResult {
  files: PluginFile[];
}
