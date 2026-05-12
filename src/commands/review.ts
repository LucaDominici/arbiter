/**
 * `arbiter review plan <file>` (#235).
 *
 * Reads a plan markdown file, dispatches a subagent plan-review pass, and
 * exits with a verdict-based exit code:
 *
 *   0 = PASS     1 = WARN     2 = FAIL
 *
 * Note: this exit-code convention deliberately differs from the project
 * default `statusToExitCode` (which uses 2 for warning) because plan
 * review treats a missing/incomplete plan (FAIL) as the harder failure
 * mode that should block CI.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  dispatchPlanReview,
  type DispatchResult,
  type SubagentDispatcher,
} from "../review/dispatch.js";
import type { ReviewTier } from "../review/tier-constants.js";
import { jsonOutput, type JsonStatus } from "../utils/json-output.js";

export interface ReviewPlanOptions {
  file: string;
  dir?: string;
  tier?: ReviewTier;
  json?: boolean;
  /** Test hook: inject a fake subagent to avoid spawning `claude`. */
  dispatcher?: SubagentDispatcher;
}

export interface ReviewPlanResult {
  exitCode: 0 | 1 | 2;
  verdict: DispatchResult["verdict"] | "ERROR";
  reason?: string;
}

function verdictToJsonStatus(verdict: DispatchResult["verdict"]): JsonStatus {
  if (verdict === "PASS") return "ok";
  if (verdict === "WARN") return "warning";
  return "error";
}

export function runReviewPlan(opts: ReviewPlanOptions): ReviewPlanResult {
  const dir = resolve(opts.dir ?? ".");
  const planPath = resolve(opts.file);
  if (!existsSync(planPath)) {
    if (opts.json) {
      jsonOutput("review plan", "error", { file: planPath }, [
        `plan file not found: ${planPath}`,
      ]);
    } else {
      process.stderr.write(`Error: plan file not found: ${planPath}\n`);
    }
    return {
      exitCode: 2,
      verdict: "ERROR",
      reason: "plan file not found",
    };
  }

  const planContent = readFileSync(planPath, "utf-8");
  const tier: ReviewTier = opts.tier ?? "S";
  const dispatched = dispatchPlanReview({
    planContent,
    dir,
    tier,
    ...(opts.dispatcher ? { dispatcher: opts.dispatcher } : {}),
  });

  if (opts.json) {
    jsonOutput("review plan", verdictToJsonStatus(dispatched.verdict), {
      verdict: dispatched.verdict,
      attempts: dispatched.attempts,
      promptPath: dispatched.promptPath,
      tier,
    });
  } else {
    process.stdout.write(
      `review plan: ${dispatched.verdict} (attempts=${dispatched.attempts}, tier=${tier})\n`,
    );
  }

  return {
    exitCode: dispatched.exitCode,
    verdict: dispatched.verdict,
  };
}
