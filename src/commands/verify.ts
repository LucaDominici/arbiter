import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { runProbes } from "../compatibility/probe.js";
import { formatText, formatJson } from "../compatibility/report.js";
import { loadConfig } from "../utils/config.js";
import { verifySummarySha } from "../risk/sha-check.js";

export interface VerifyOptions {
  dir?: string | undefined;
  json?: boolean | undefined;
}

export interface VerifyEvidenceResult {
  status: "ok" | "warning" | "error";
  exitCode: 0 | 1 | 2;
  reason?: string;
  skipped?: boolean;
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

/**
 * Verify an existing `.evidence/SUMMARY.json` snapshot. Returns a result
 * envelope so callers (CLI / programmatic) can decide how to surface it.
 *
 * Exit code conventions (canonical CLI convention — see CLI.md §Exit codes):
 *   0 = ok (or E2E_RISK_SKIP set with a valid reason)
 *   1 = missing/unreadable SUMMARY.json, invalid JSON, or stale (>FRESHNESS_DAYS) — advisory
 *   2 = SHA mismatch (blocker — tampered or state diverged)
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

  const ts = parsed["timestamp"];
  if (typeof ts === "string") {
    const tsMs = Date.parse(ts);
    if (Number.isFinite(tsMs)) {
      const ageDays = (Date.now() - tsMs) / MS_PER_DAY;
      if (ageDays > FRESHNESS_DAYS) {
        // Stale evidence is an advisory failure (exit 1, not 0):
        // CI should flag it but downstream callers may still pass.
        return {
          status: "warning",
          exitCode: 1,
          reason: `summary is ${ageDays.toFixed(1)} days old (>${FRESHNESS_DAYS})`,
        };
      }
    }
  }

  return { status: "ok", exitCode: 0 };
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
