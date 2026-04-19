import type { ArbiterConfig } from "../utils/config.js";

export interface ArbiterPlugin {
  name: string;
  apiVersion: "1";
  templateRoot: string;
  detect?(config: ArbiterConfig): boolean;
  generate(ctx: PluginContext): PluginResult;
}

export interface PluginContext {
  config: ArbiterConfig;
  targetDir: string;
  renderTemplate(relPath: string, data: Record<string, unknown>): string;
}

export interface PluginFile {
  path: string;
  content: string;
  action?: "create" | "backup-and-replace" | "skip";
}

export interface PluginResult {
  files: PluginFile[];
}
