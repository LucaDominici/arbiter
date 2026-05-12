/**
 * Plan-review subagent dispatcher (#235).
 *
 * Builds an XML prompt around a plan file, persists it to
 * `.evidence/review-<timestamp>/plan-review-prompt.txt`, dispatches a
 * Claude subagent through an injectable interface, then maps the verdict
 * to an exit code:
 *
 *   PASS → 0   WARN → 1   FAIL → 2
 *
 * Up to 2 revise-cycles are allowed on WARN. FAIL fails fast.
 *
 * The subagent invocation itself goes through `runCli` (INV-12) by default;
 * tests inject a fake dispatcher to avoid spawning real CLIs.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../utils/run-cli.js";
import { TIER_PASS_COUNT, type ReviewTier } from "./tier-constants.js";

export type Verdict = "PASS" | "WARN" | "FAIL";

export interface SubagentResult {
  stdout: string;
  exitCode: number;
}

export interface SubagentDispatcher {
  run(prompt: string): SubagentResult;
}

export interface BuildPromptOptions {
  planContent: string;
  dir: string;
  tier: ReviewTier;
}

export interface DispatchOptions extends BuildPromptOptions {
  /** Optional dispatcher override — tests pass a fake here. */
  dispatcher?: SubagentDispatcher;
}

export interface DispatchResult {
  verdict: Verdict;
  exitCode: 0 | 1 | 2;
  attempts: number;
  promptPath: string;
}

const MAX_REVISE_CYCLES = 2;

function computeSsotDigest(dir: string): string {
  const agentsPath = join(dir, "AGENTS.md");
  if (!existsSync(agentsPath)) return "0".repeat(64);
  const body = readFileSync(agentsPath, "utf-8");
  return createHash("sha256").update(body).digest("hex");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildReviewPrompt(opts: BuildPromptOptions): string {
  const digest = computeSsotDigest(opts.dir);
  const safePlan = escapeXml(opts.planContent);
  const passCount = TIER_PASS_COUNT[opts.tier];
  return [
    `<review version="1">`,
    `  <tier>${opts.tier}</tier>`,
    `  <passCount>${passCount}</passCount>`,
    `  <ssotDigest>${digest}</ssotDigest>`,
    `  <instructions>`,
    `    Evaluate the plan against AGENTS.md invariants and produce a verdict:`,
    `    "verdict: PASS"  — plan is implementable as-is`,
    `    "verdict: WARN"  — plan has fixable gaps; reviser MAY revise once`,
    `    "verdict: FAIL"  — plan violates an invariant or is incoherent`,
    `  </instructions>`,
    `  <plan>`,
    safePlan,
    `  </plan>`,
    `</review>`,
  ].join("\n");
}

function parseVerdict(stdout: string): Verdict {
  const m = stdout.match(/verdict:\s*(PASS|WARN|FAIL)/i);
  if (!m) return "FAIL";
  const captured = m[1];
  if (captured === undefined) return "FAIL";
  return captured.toUpperCase() as Verdict;
}

/** Default dispatcher: spawns `claude` via runCli (INV-12). */
const DEFAULT_DISPATCHER: SubagentDispatcher = {
  run(prompt: string): SubagentResult {
    const result = runCli("claude", ["-p", prompt], { timeoutMs: 600_000 });
    return { stdout: result.stdout, exitCode: result.exitCode };
  },
};

function evidenceDirFor(dir: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dir, ".evidence", `review-${ts}`);
}

function persistPrompt(dir: string, prompt: string): string {
  const reviewDir = evidenceDirFor(dir);
  mkdirSync(reviewDir, { recursive: true });
  const path = join(reviewDir, "plan-review-prompt.txt");
  writeFileSync(path, prompt, "utf-8");
  return path;
}

function verdictToExitCode(verdict: Verdict): 0 | 1 | 2 {
  if (verdict === "PASS") return 0;
  if (verdict === "WARN") return 1;
  return 2;
}

export function dispatchPlanReview(opts: DispatchOptions): DispatchResult {
  const prompt = buildReviewPrompt(opts);
  const promptPath = persistPrompt(opts.dir, prompt);
  const dispatcher = opts.dispatcher ?? DEFAULT_DISPATCHER;

  let attempts = 0;
  let lastVerdict: Verdict = "FAIL";
  // 1 initial pass + up to MAX_REVISE_CYCLES revisions = MAX+1 invocations total
  for (let i = 0; i <= MAX_REVISE_CYCLES; i++) {
    attempts++;
    const r = dispatcher.run(prompt);
    lastVerdict = parseVerdict(r.stdout);
    if (lastVerdict === "PASS") break;
    if (lastVerdict === "FAIL") break;
    // WARN — try another revision pass
  }

  return {
    verdict: lastVerdict,
    exitCode: verdictToExitCode(lastVerdict),
    attempts,
    promptPath,
  };
}
