import type {
  AiTool,
  Archetype,
  ArchitectureStyle,
  ContractType,
  EvidenceRetentionConfig,
  GovernanceLevel,
  InvariantTier,
  StrictnessTier,
  ThresholdProfile,
  ThresholdsV2,
  WorktreeConfig,
} from "../wizard/types.js";

export type { ThresholdsV2 };

export interface FeatureFlags {
  contractTesting: boolean;
  mutationTesting: boolean;
  securityScanning: boolean;
  evidenceHarness: boolean;
  debtGates: boolean;
  suppressions: boolean;
}

export type DecompositionBackendId = "github" | "markdown";

export interface DecompositionConfig {
  backend: DecompositionBackendId;
  markdown?: { dir: string };
  github?: { owner: string; repo: string };
}

export interface ArbiterConfigV2 {
  version: string;
  tools: AiTool[];
  governanceLevel: GovernanceLevel;
  useGitHub: boolean;
  decomposition?: DecompositionConfig;
  features: FeatureFlags;
  thresholds: ThresholdsV2;
  archetype?: Archetype;
  architectureStyle?: ArchitectureStyle;
  isMultiTenant?: boolean;
  hasDatabase?: boolean;
  hasPublicApi?: boolean;
  acceptBetaTools?: boolean;
  evidenceRetention?: EvidenceRetentionConfig;
  thresholdProfile?: ThresholdProfile;
  strictnessTier?: StrictnessTier;
  graceEndsAt?: string;
  graceFromLevel?: GovernanceLevel;
  contractType?: ContractType;
  invariantTiers?: InvariantTier[];
  worktree?: WorktreeConfig;
  enableObsidianVault?: boolean;
  plugins?: string[];
}

export type ValidateResult =
  | { ok: true; config: ArbiterConfigV2 }
  | { ok: false; errors: string[] };

export const DEFAULT_THRESHOLDS: Record<GovernanceLevel, ThresholdsV2> = {
  L1: {
    lineCoverage: 60,
    branchCoverage: 50,
    mutationScore: 70,
    cyclomaticComplexity: 20,
    methodLength: 100,
    maxParams: 8,
  },
  L2: {
    lineCoverage: 80,
    branchCoverage: 70,
    mutationScore: 80,
    cyclomaticComplexity: 15,
    methodLength: 65,
    maxParams: 7,
  },
  L3: {
    lineCoverage: 85,
    branchCoverage: 80,
    mutationScore: 85,
    cyclomaticComplexity: 10,
    methodLength: 40,
    maxParams: 5,
  },
};

const GOVERNANCE_LEVELS: ReadonlySet<string> = new Set(["L1", "L2", "L3"]);
const AI_TOOLS: ReadonlySet<string> = new Set([
  "claude",
  "codex",
  "cursor",
  "copilot",
]);

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function validateThresholds(raw: unknown, errors: string[]): boolean {
  if (!isRecord(raw)) {
    errors.push("thresholds must be an object");
    return false;
  }
  let ok = true;
  const coverage = ["lineCoverage", "branchCoverage", "mutationScore"] as const;
  for (const key of coverage) {
    const v = raw[key];
    if (typeof v !== "number" || v <= 0 || v > 100) {
      errors.push(`thresholds.${key} must be a number between 1 and 100`);
      ok = false;
    }
  }
  const positive = [
    "cyclomaticComplexity",
    "methodLength",
    "maxParams",
  ] as const;
  for (const key of positive) {
    const v = raw[key];
    if (typeof v !== "number" || v <= 0) {
      errors.push(`thresholds.${key} must be a positive number`);
      ok = false;
    }
  }
  return ok;
}

function validateFeatures(raw: unknown, errors: string[]): boolean {
  if (!isRecord(raw)) {
    errors.push("features must be an object");
    return false;
  }
  let ok = true;
  const flags = [
    "contractTesting",
    "mutationTesting",
    "securityScanning",
    "evidenceHarness",
    "debtGates",
    "suppressions",
  ] as const;
  for (const key of flags) {
    if (typeof raw[key] !== "boolean") {
      errors.push(`features.${key} must be a boolean`);
      ok = false;
    }
  }
  return ok;
}

export function validateConfig(raw: unknown): ValidateResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ["config must be a non-null object"] };
  }

  const errors: string[] = [];

  if (typeof raw["version"] !== "string") {
    errors.push("version must be a string");
  }

  const level = raw["governanceLevel"];
  if (typeof level !== "string" || !GOVERNANCE_LEVELS.has(level)) {
    errors.push(
      `governanceLevel must be one of L1, L2, L3 — got ${String(level)}`,
    );
  }

  if (
    !Array.isArray(raw["tools"]) ||
    (raw["tools"] as unknown[]).some((t) => !AI_TOOLS.has(t as string))
  ) {
    errors.push("tools must be an array of valid AI tools");
  }

  if (typeof raw["useGitHub"] !== "boolean") {
    errors.push("useGitHub must be a boolean");
  }

  validateFeatures(raw["features"], errors);
  validateThresholds(raw["thresholds"], errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const config = { ...raw } as unknown as ArbiterConfigV2;
  return { ok: true, config };
}

interface LegacyEvidenceRetention {
  enabled?: boolean;
}

function deriveEvidenceHarness(
  evidenceRetention: unknown,
  level: string,
): boolean {
  if (isRecord(evidenceRetention)) {
    const legacy = evidenceRetention as LegacyEvidenceRetention;
    if (typeof legacy.enabled === "boolean") {
      return legacy.enabled;
    }
  }
  return level === "L3";
}

export function migrateV1ToV2(raw: unknown): ArbiterConfigV2 {
  if (!isRecord(raw)) {
    throw new Error("arbiter.json must be a non-null object");
  }

  if (raw["version"] === "0.2") {
    const result = validateConfig(raw);
    if (result.ok) return result.config;
    throw new Error(
      `arbiter.json v0.2 is invalid: ${result.errors.join("; ")}`,
    );
  }

  const rawLevel = raw["governanceLevel"];
  const level: GovernanceLevel =
    rawLevel === "L1" || rawLevel === "L2" || rawLevel === "L3"
      ? rawLevel
      : "L2";
  const nonL1 = level !== "L1";

  const features: FeatureFlags = {
    debtGates:
      typeof raw["enableDebtGates"] === "boolean"
        ? raw["enableDebtGates"]
        : nonL1,
    securityScanning:
      typeof raw["enableSecurityScanning"] === "boolean"
        ? raw["enableSecurityScanning"]
        : nonL1,
    suppressions:
      typeof raw["enableSuppressions"] === "boolean"
        ? raw["enableSuppressions"]
        : true,
    mutationTesting: nonL1,
    contractTesting:
      typeof raw["contractType"] === "string" && raw["contractType"] !== "none",
    evidenceHarness: deriveEvidenceHarness(raw["evidenceRetention"], level),
  };

  const thresholds: ThresholdsV2 = DEFAULT_THRESHOLDS[level];

  const stripKeys = new Set([
    "version",
    "enableDebtGates",
    "enableSecurityScanning",
    "enableSuppressions",
  ]);
  const rest = Object.fromEntries(
    Object.entries(raw).filter(([k]) => !stripKeys.has(k)),
  );

  return {
    ...rest,
    version: "0.2",
    tools: Array.isArray(raw["tools"])
      ? (raw["tools"] as unknown[]).filter((t): t is AiTool =>
          AI_TOOLS.has(t as string),
        )
      : (["claude", "codex"] as AiTool[]),
    governanceLevel: level,
    useGitHub: typeof raw["useGitHub"] === "boolean" ? raw["useGitHub"] : false,
    features,
    thresholds,
  } as unknown as ArbiterConfigV2;
}
