import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AiTool, GovernanceLevel } from "../wizard/types.js";

export interface ArbiterConfig {
  version: string;
  tools: AiTool[];
  governanceLevel: GovernanceLevel;
  useGitHub: boolean;
  enableDebtGates?: boolean;
}

const CONFIG_FILE = "arbiter.json";
const CURRENT_VERSION = "0.1";

export function saveConfig(dir: string, config: ArbiterConfig): void {
  const path = join(dir, CONFIG_FILE);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function loadConfig(dir: string): ArbiterConfig | null {
  const path = join(dir, CONFIG_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ArbiterConfig;
  } catch {
    return null;
  }
}

export function defaultConfig(): ArbiterConfig {
  return {
    version: CURRENT_VERSION,
    tools: ["claude", "codex"],
    governanceLevel: "L2",
    useGitHub: false,
  };
}
