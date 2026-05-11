/**
 * Migration: v1 ("0.1") → v2 ("0.2")
 *
 * Converts the legacy v1 flat-flag format into the canonical ArbiterConfigV2.
 * Also handles v2 ("0.2") input idempotently — validates and returns as-is
 * (with decomposition alias applied if absent).
 *
 * Issue: #231
 */

import type { AiTool, GovernanceLevel } from "../../wizard/types.js";
import {
  type ArbiterConfigV2,
  type DecompositionBackendId,
  type FeatureFlags,
  type ThresholdsV2,
  DEFAULT_THRESHOLDS,
  validateConfig,
} from "../schema.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

const AI_TOOLS: ReadonlySet<string> = new Set([
  "claude",
  "codex",
  "cursor",
  "copilot",
]);

let _useGitHubWarnEmitted = false;

function warnUseGitHubDeprecated(): void {
  if (_useGitHubWarnEmitted) return;
  _useGitHubWarnEmitted = true;
  process.stderr.write(
    '[arbiter] Warning: `useGitHub` is deprecated. Use `decomposition.backend: "github"|"markdown"` instead.\n',
  );
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

function deriveFeatureFlags(
  raw: Record<string, unknown>,
  level: GovernanceLevel,
): FeatureFlags {
  const nonL1 = level !== "L1";
  return {
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
}

function applyDecompositionAlias(cfg: ArbiterConfigV2): ArbiterConfigV2 {
  if (cfg.decomposition?.backend) return cfg;
  warnUseGitHubDeprecated();
  const backend: DecompositionBackendId = cfg.useGitHub ? "github" : "markdown";
  return { ...cfg, decomposition: { backend } };
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Migrates a v1 ("0.1") config to v2 ("0.2"), or returns a v2 input unchanged.
 *
 * @throws if the input is not a non-null object, or if a v2 input fails validation.
 */
export function migrateV1ToV2(raw: unknown): ArbiterConfigV2 {
  if (!isRecord(raw)) {
    throw new Error("arbiter.json must be a non-null object");
  }

  // ── already v2: validate and pass through ────────────────────────────────
  if (raw["version"] === "0.2") {
    const result = validateConfig(raw);
    if (result.ok) return applyDecompositionAlias(result.config);
    throw new Error(
      `arbiter.json v0.2 is invalid: ${result.errors.join("; ")}`,
    );
  }

  // ── v1 ("0.1") → v2 ("0.2") ──────────────────────────────────────────────
  const rawLevel = raw["governanceLevel"];
  const level: GovernanceLevel =
    rawLevel === "L1" || rawLevel === "L2" || rawLevel === "L3"
      ? rawLevel
      : "L2";

  const features: FeatureFlags = deriveFeatureFlags(raw, level);
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

  const useGitHub =
    typeof raw["useGitHub"] === "boolean" ? raw["useGitHub"] : false;
  const migratedBackend: DecompositionBackendId = useGitHub
    ? "github"
    : "markdown";

  // Preserve explicit decomposition if present (do not override)
  const decomposition: { backend: DecompositionBackendId } =
    isRecord(raw["decomposition"]) && raw["decomposition"]["backend"]
      ? (raw["decomposition"] as { backend: DecompositionBackendId })
      : { backend: migratedBackend };

  return {
    ...rest,
    version: "0.2",
    tools: Array.isArray(raw["tools"])
      ? (raw["tools"] as unknown[]).filter((t): t is AiTool =>
          AI_TOOLS.has(t as string),
        )
      : (["claude", "codex"] as AiTool[]),
    governanceLevel: level,
    useGitHub,
    decomposition,
    features,
    thresholds,
  };
}
