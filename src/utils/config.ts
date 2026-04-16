import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AiTool,
  Archetype,
  ArchitectureStyle,
  GovernanceLevel,
  InvariantTier,
  WorktreeConfig,
} from "../wizard/types.js";
import { presetToTiers, defaultPresetForLevel } from "../invariants/filter.js";

export interface ArbiterConfig {
  version: string;
  tools: AiTool[];
  governanceLevel: GovernanceLevel;
  useGitHub: boolean;
  enableDebtGates?: boolean;
  enableSuppressions?: boolean;
  invariantTiers?: InvariantTier[];
  worktree?: WorktreeConfig;
  /** Whether the Obsidian vault generator ran during init. Used by `arbiter obsidian` sync. */
  enableObsidianVault?: boolean;
  // Phase 9.5 MA: archetype axis fields — optional for backward compat with arbiter.json v0.1
  archetype?: Archetype;
  architectureStyle?: ArchitectureStyle;
  isMultiTenant?: boolean;
  hasDatabase?: boolean;
  hasPublicApi?: boolean;
  // Phase 9.5 ME: beta-tool override — persisted for audit trail
  acceptBetaTools?: boolean;
  // Phase 9.5 MJ: evidence retention policy — persisted for arbiter update
  evidenceRetention?: import("../wizard/types.js").EvidenceRetentionConfig;
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
  const governanceLevel = "L2";
  return {
    version: CURRENT_VERSION,
    tools: ["claude", "codex"],
    governanceLevel,
    useGitHub: false,
    invariantTiers: presetToTiers(defaultPresetForLevel(governanceLevel)),
    archetype: "library",
    architectureStyle: "none",
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
  };
}
