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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError, runCli } from "../utils/run-cli.js";
import type { AgentReport, AgentResult, Finding } from "./multi-agent.js";
import { computeSsotDigest, escapeXml } from "./ssot.js";
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

/**
 * Multi-agent reviewer dispatch (#236).
 *
 * Spawns `claude -p <prompt>` via runCli (INV-12) for one persona, parses
 * the JSON envelope on stdout, and optionally persists the raw response
 * under `<evidenceDir>/agent-<name>.json`. Failures (timeout, malformed
 * JSON, non-zero exit) are surfaced as a single blocker finding so the
 * caller's aggregator never silently drops an agent.
 */
export interface DispatchClaudeAgentOptions {
  /** Optional override of the claude binary command — defaults to "claude". */
  cmd?: string;
  /** Timeout per agent invocation in milliseconds. */
  timeoutMs?: number;
  /** If set, the raw agent response is written to `<evidenceDir>/agent-<name>.json`. */
  evidenceDir?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFinding(v: unknown): v is Finding {
  if (!isRecord(v)) return false;
  const sev = v["severity"];
  if (sev !== "blocker" && sev !== "warning" && sev !== "note") return false;
  if (typeof v["agent"] !== "string") return false;
  if (typeof v["message"] !== "string") return false;
  return true;
}

/**
 * Extract the first balanced `{...}` block from `s`.
 *
 * Walks the string tracking brace depth, ignoring braces inside JSON
 * string literals (handles escaped quotes). Returns the substring or
 * null when no balanced block is found.
 *
 * Why not regex: the greedy `/\{[\s\S]*\}/` would consume everything
 * between the first `{` and the LAST `}` — fine for clean input, but
 * agents are allowed to follow JSON output with prose, and that prose
 * is allowed to contain `}` characters. Brace-depth scanning is the
 * minimal correct approach.
 */
export function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAgentReport(stdout: string, agent: string): AgentReport {
  const trimmed = stdout.trim();
  const payload = extractFirstJsonObject(trimmed) ?? trimmed;
  const parsed: unknown = JSON.parse(payload);
  if (!isRecord(parsed)) {
    throw new Error(`agent "${agent}" returned non-object payload`);
  }
  const findingsRaw = parsed["findings"];
  if (!Array.isArray(findingsRaw)) {
    throw new Error(`agent "${agent}" missing "findings" array`);
  }
  const findings: Finding[] = [];
  for (const f of findingsRaw) {
    if (!isFinding(f)) {
      throw new Error(`agent "${agent}" produced a malformed finding`);
    }
    findings.push(f);
  }
  const passed = parsed["passed"] === true;
  return { findings, passed };
}

export function dispatchClaudeAgent(
  opts: DispatchClaudeAgentOptions = {},
): (prompt: string, agentName: string) => Promise<AgentResult> {
  const cmd = opts.cmd ?? "claude";
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const evidenceDir = opts.evidenceDir;

  return (prompt: string, agentName: string): Promise<AgentResult> => {
    let rawStdout = "";
    try {
      const result = runCli(cmd, ["-p", prompt], { timeoutMs });
      rawStdout = result.stdout;
      const report = parseAgentReport(rawStdout, agentName);
      const agentResult: AgentResult = {
        agent: agentName,
        findings: report.findings,
        passed: report.passed,
        rawStdout,
        prompt,
      };
      if (evidenceDir !== undefined) {
        persistAgentResponse(evidenceDir, agentName, agentResult);
      }
      return Promise.resolve(agentResult);
    } catch (err) {
      const isTimeout = err instanceof CliError && err.timedOut;
      const message = err instanceof Error ? err.message : String(err);
      const reason = isTimeout
        ? `agent "${agentName}" timed out after ${timeoutMs}ms`
        : `agent "${agentName}" failed: ${message}`;
      const failResult: AgentResult = {
        agent: agentName,
        findings: [
          {
            severity: "blocker",
            agent: agentName,
            message: reason,
          },
        ],
        passed: false,
        rawStdout,
        prompt,
      };
      if (evidenceDir !== undefined) {
        persistAgentResponse(evidenceDir, agentName, failResult);
      }
      return Promise.resolve(failResult);
    }
  };
}

function persistAgentResponse(
  evidenceDir: string,
  agentName: string,
  result: AgentResult,
): void {
  mkdirSync(evidenceDir, { recursive: true });
  const path = join(evidenceDir, `agent-${agentName}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        agent: result.agent,
        passed: result.passed,
        findings: result.findings,
        rawStdout: result.rawStdout,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

/** Build a fresh evidence dir for a multi-agent code-review run. */
export function makeCodeReviewEvidenceDir(dir: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, ".evidence", `review-${ts}`);
  mkdirSync(path, { recursive: true });
  return path;
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
