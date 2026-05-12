import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { runProbes } from "../compatibility/probe.js";
import { formatText, formatJson } from "../compatibility/report.js";
import { loadConfig } from "../utils/config.js";
import { detectLanguage } from "../detectors/language.js";
import { verifySummarySha } from "../risk/sha-check.js";
import {
  classifyPath,
  highestRisk,
  UNCLASSIFIED_LEVEL,
  type ClassifyResult,
  type RiskLevel,
} from "../risk/classifier.js";
import type { Language } from "../wizard/types.js";

export interface VerifyOptions {
  dir?: string | undefined;
  json?: boolean | undefined;
}

export interface VerifyEvidenceResult {
  status: "ok" | "warning" | "error";
  exitCode: 0 | 1 | 2;
  reason?: string;
  skipped?: boolean;
  /** Aggregate risk level across SUMMARY.json `files[]`. Absent when the
   *  summary has no `files` field or no skip-applicable path was reached. */
  riskLevel?: ClassifyResult;
}

const FRESHNESS_DAYS = 7;
const MS_PER_DAY = 86_400_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function writeSkipEntry(dir: string, reason: string): void {
  try {
    const evidenceDir = join(dir, ".evidence");
    mkdirSync(evidenceDir, { recursive: true });
    appendFileSync(
      join(evidenceDir, "skip-log.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), reason }) + "\n",
      "utf-8",
    );
  } catch {
    // Skip-log writes are best-effort — never break the command.
  }
}

/** Languages the risk classifier knows about. */
const KNOWN_STACKS: ReadonlySet<Language> = new Set<Language>([
  "typescript",
  "java",
  "kotlin",
  "rust",
  "python",
  "go",
]);

/**
 * Resolve the stack to classify against, in order of preference:
 *   1. The `stack` field embedded in SUMMARY.json (signed by the SHA)
 *   2. `detectLanguage(dir)` from the project on disk
 */
function resolveStack(
  summary: Record<string, unknown>,
  dir: string,
): Language {
  const stored = summary["stack"];
  if (typeof stored === "string" && KNOWN_STACKS.has(stored as Language)) {
    return stored as Language;
  }
  return detectLanguage(dir);
}

/** Aggregate risk across the SUMMARY.json `files[]` array, if present. */
function classifyFiles(
  summary: Record<string, unknown>,
  stack: Language,
): ClassifyResult | null {
  const raw = summary["files"];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const levels: ClassifyResult[] = [];
  for (const f of raw) {
    if (typeof f !== "string") continue;
    levels.push(classifyPath(f, stack));
  }
  if (levels.length === 0) return null;
  return highestRisk(levels);
}

/**
 * Risk-driven stale gating: how severe should stale evidence be at this
 * risk level? Returns the (exit code, status) pair to use.
 *
 *   R0/R1 (high risk)  → blocker (exit 2)
 *   R2     (medium)    → blocker (exit 2)
 *   R3/R4 (low risk)   → warning (exit 1)
 *
 * The higher-risk the change, the less we tolerate stale evidence.
 */
function staleSeverity(level: RiskLevel): {
  exitCode: 1 | 2;
  status: "warning" | "error";
} {
  if (level === "R0" || level === "R1" || level === "R2") {
    return { exitCode: 2, status: "error" };
  }
  return { exitCode: 1, status: "warning" };
}

/**
 * Verify an existing `.evidence/SUMMARY.json` snapshot. Returns a result
 * envelope so callers (CLI / programmatic) can decide how to surface it.
 *
 * Exit code conventions (canonical CLI convention — see CLI.md §Exit codes):
 *   0 = ok (or E2E_RISK_SKIP set with a valid reason)
 *   1 = missing/unreadable SUMMARY.json, invalid JSON, low-risk stale, or unclassified
 *   2 = SHA mismatch, or stale evidence on medium/high-risk changes (R0-R2)
 *
 * Risk gating: when SUMMARY.json carries a non-empty `files[]` array, each
 * file is classified via `classifyPath(file, stack)` and the highest risk
 * level drives gate strictness — see `staleSeverity` below.
 *
 * #238
 */
export function runVerifyEvidence(opts: VerifyOptions): VerifyEvidenceResult {
  const dir = resolve(opts.dir ?? ".");
  const skip = process.env["E2E_RISK_SKIP"];
  if (skip && skip.trim() !== "") {
    writeSkipEntry(dir, skip);
    return { status: "ok", exitCode: 0, skipped: true, reason: skip };
  }

  const summaryPath = join(dir, ".evidence", "SUMMARY.json");
  if (!existsSync(summaryPath)) {
    return {
      status: "error",
      exitCode: 1,
      reason: ".evidence/SUMMARY.json not found",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(summaryPath, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      exitCode: 1,
      reason: `invalid JSON: ${msg}`,
    };
  }
  if (!isRecord(parsed)) {
    return {
      status: "error",
      exitCode: 1,
      reason: "SUMMARY.json root must be an object",
    };
  }

  const shaResult = verifySummarySha(parsed);
  if (!shaResult.ok) {
    return {
      status: "error",
      exitCode: 2,
      reason: shaResult.reason ?? "sha mismatch",
    };
  }

  // Classify the change set (if any files are listed) so we can scale
  // freshness severity to risk. Absent files[] → no risk gating possible
  // and we fall back to the legacy advisory-only stale behaviour.
  const stack = resolveStack(parsed, dir);
  const riskLevel = classifyFiles(parsed, stack);

  // UNCLASSIFIED in the changeset means the consumer must decide — we
  // refuse to fail open. Surfaces as advisory (exit 1) with a clear reason.
  if (riskLevel === UNCLASSIFIED_LEVEL) {
    return {
      status: "warning",
      exitCode: 1,
      riskLevel,
      reason:
        "one or more files could not be classified — manual review required",
    };
  }

  const ts = parsed["timestamp"];
  if (typeof ts === "string") {
    const tsMs = Date.parse(ts);
    if (Number.isFinite(tsMs)) {
      const ageDays = (Date.now() - tsMs) / MS_PER_DAY;
      if (ageDays > FRESHNESS_DAYS) {
        // Stale: severity scales with risk. Low-risk changes are advisory,
        // higher-risk changes block (CI must fail).
        const sev = riskLevel === null ? null : staleSeverity(riskLevel);
        const ageStr = `summary is ${ageDays.toFixed(1)} days old (>${FRESHNESS_DAYS})`;
        if (sev === null) {
          return { status: "warning", exitCode: 1, reason: ageStr };
        }
        return {
          status: sev.status,
          exitCode: sev.exitCode,
          riskLevel,
          reason:
            sev.exitCode === 2
              ? `${ageStr}; high-risk change set requires fresh evidence`
              : ageStr,
        };
      }
    }
  }

  const result: VerifyEvidenceResult = { status: "ok", exitCode: 0 };
  if (riskLevel !== null) result.riskLevel = riskLevel;
  return result;
}

export function runVerify(opts: VerifyOptions): void {
  const dir = resolve(opts.dir ?? ".");
  const report = runProbes(dir);

  if (opts.json) {
    // Augment the JSON envelope with the effective (post-env-override) config
    // so external consumers can see exactly what arbiter loaded — #233.
    const cfg = loadConfig(dir);
    const enriched = {
      ...report,
      effectiveConfig: cfg,
    };
    process.stdout.write(formatJson(enriched) + "\n");
  } else {
    process.stdout.write(formatText(report) + "\n");
  }

  if (report.hasFailures) {
    process.exit(1);
  }
}
