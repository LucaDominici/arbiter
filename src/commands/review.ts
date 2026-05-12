/**
 * `arbiter review plan <file>` (#235).
 *
 * Reads a plan markdown file, dispatches a subagent plan-review pass, and
 * exits with a verdict-based exit code:
 *
 *   0 = PASS     1 = WARN     2 = FAIL
 *
 * Matches the canonical CLI exit-code convention (0=ok, 1=warning,
 * 2=error/blocker — see `src/utils/json-output.ts::statusToExitCode`
 * and `docs/REFERENCE/CLI.md` §Exit codes).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  dispatchClaudeAgent,
  dispatchPlanReview,
  makeCodeReviewEvidenceDir,
  type DispatchResult,
  type SubagentDispatcher,
} from "../review/dispatch.js";
import {
  aggregateFindings,
  buildAgentPrompts,
  dispatchAgents,
  type AgentResult,
  type AggregatedReview,
  type DispatchFn,
} from "../review/multi-agent.js";
import type { ReviewTier } from "../review/tier-constants.js";
import { jsonOutput, type JsonStatus } from "../utils/json-output.js";
import { runCli } from "../utils/run-cli.js";

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

/* ─────────────────────────  review code (#236)  ───────────────────────── */

export interface ReviewCodeOptions {
  dir?: string;
  tier?: ReviewTier;
  json?: boolean;
  /** Override git diff target ref (default: "origin/main"). */
  diffRef?: string;
  /** Override evidence directory (default: `.evidence/review-<timestamp>/`). */
  evidenceDir?: string;
  /** Test hook: pre-computed diff content (skips `git diff`). */
  diffOverride?: string;
  /** Test hook: injected dispatcher to avoid spawning `claude`. */
  dispatcher?: DispatchFn;
}

export interface ReviewCodeResult {
  exitCode: 0 | 1 | 2;
  aggregated: AggregatedReview;
  evidenceDir: string;
}

function aggregatedToExitCode(agg: AggregatedReview): 0 | 1 | 2 {
  if (agg.blockers.length > 0) return 2;
  if (agg.warnings.length > 0) return 1;
  return 0;
}

function aggregatedToJsonStatus(agg: AggregatedReview): JsonStatus {
  if (agg.blockers.length > 0) return "error";
  if (agg.warnings.length > 0) return "warning";
  return "ok";
}

function persistAgentResults(
  evidenceDir: string,
  results: AgentResult[],
): void {
  mkdirSync(evidenceDir, { recursive: true });
  for (const r of results) {
    const path = join(evidenceDir, `agent-${r.agent}.json`);
    // Skip if dispatcher already wrote this file (real dispatchClaudeAgent does).
    if (existsSync(path)) continue;
    writeFileSync(
      path,
      JSON.stringify(
        {
          agent: r.agent,
          passed: r.passed,
          findings: r.findings,
          rawStdout: r.rawStdout,
        },
        null,
        2,
      ),
      "utf-8",
    );
  }
}

function resolveDiff(opts: ReviewCodeOptions, dir: string): string {
  if (opts.diffOverride !== undefined) return opts.diffOverride;
  const ref = opts.diffRef ?? "origin/main";
  const result = runCli("git", ["diff", `${ref}...HEAD`], {
    cwd: dir,
    timeoutMs: 60_000,
  });
  return result.stdout;
}

/**
 * Build a synthetic blocker-finding result envelope for an infrastructure
 * failure (git diff, prompt build, evidence-dir creation, etc.). These
 * are not agent verdicts — they are pre-dispatch errors that must NOT
 * silently exit with the "no findings" exit code.
 */
function infraFailureResult(
  err: unknown,
  evidenceDir: string,
): ReviewCodeResult {
  const message = err instanceof Error ? err.message : String(err);
  const finding = {
    severity: "blocker" as const,
    agent: "infrastructure",
    message: `review-code infra failure: ${message}`,
  };
  const aggregated = {
    blockers: [finding],
    warnings: [],
    notes: [],
    passCount: 0,
    totalAgents: 0,
  };
  return { exitCode: 2, aggregated, evidenceDir };
}

export async function runReviewCode(
  opts: ReviewCodeOptions,
): Promise<ReviewCodeResult> {
  const dir = resolve(opts.dir ?? ".");
  const tier: ReviewTier = opts.tier ?? "Standard";
  const evidenceDir = opts.evidenceDir ?? makeCodeReviewEvidenceDir(dir);

  let diff: string;
  let prompts: ReturnType<typeof buildAgentPrompts>;
  try {
    diff = resolveDiff(opts, dir);
    prompts = buildAgentPrompts({ diff, dir, tier });
  } catch (err) {
    const failure = infraFailureResult(err, evidenceDir);
    if (opts.json) {
      jsonOutput("review code", "error", {
        tier,
        exitCode: failure.exitCode,
        blockers: failure.aggregated.blockers,
        warnings: [],
        notes: [],
        passCount: 0,
        totalAgents: 0,
        evidenceDir,
      });
    } else {
      const fst = failure.aggregated.blockers[0];
      process.stderr.write(
        `review code: infrastructure failure — ${fst?.message ?? "unknown"}\n`,
      );
    }
    return failure;
  }

  const dispatcher: DispatchFn =
    opts.dispatcher ?? dispatchClaudeAgent({ evidenceDir });

  const results = await dispatchAgents(prompts, { dispatch: dispatcher });
  persistAgentResults(evidenceDir, results);
  const aggregated = aggregateFindings(results);
  const exitCode = aggregatedToExitCode(aggregated);

  if (opts.json) {
    jsonOutput("review code", aggregatedToJsonStatus(aggregated), {
      tier,
      exitCode,
      blockers: aggregated.blockers,
      warnings: aggregated.warnings,
      notes: aggregated.notes,
      passCount: aggregated.passCount,
      totalAgents: aggregated.totalAgents,
      evidenceDir,
    });
  } else {
    const summary = `review code: tier=${tier} agents=${aggregated.totalAgents} blockers=${aggregated.blockers.length} warnings=${aggregated.warnings.length} notes=${aggregated.notes.length} pass=${aggregated.passCount}\n`;
    process.stdout.write(summary);
    for (const f of aggregated.blockers) {
      process.stdout.write(
        `  [BLOCKER ${f.agent}] ${f.message}${f.location ? ` (${f.location})` : ""}\n`,
      );
    }
    for (const f of aggregated.warnings) {
      process.stdout.write(
        `  [WARN ${f.agent}] ${f.message}${f.location ? ` (${f.location})` : ""}\n`,
      );
    }
    for (const f of aggregated.notes) {
      process.stdout.write(
        `  [NOTE ${f.agent}] ${f.message}${f.location ? ` (${f.location})` : ""}\n`,
      );
    }
    process.stdout.write(`evidence: ${evidenceDir}\n`);
  }

  return { exitCode, aggregated, evidenceDir };
}
