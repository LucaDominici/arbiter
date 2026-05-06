#!/usr/bin/env node
// Arbiter hook: hard-block edits in implementation phase when no plan is anchored
// Hook type: PreToolUse (Edit|Write)
// Phase-aware: blocks during "implementation" phase with no valid plan
// Injects plan context (stdout) when plan is valid — model sees it before the edit
// Exit 2: block — stderr returned to Claude as error context; user is NOT prompted
// Bypass: ARBITER_PLAN_BYPASS=1 (session-scoped — see CONTRIBUTING.md)
import { readTaskState, getRepoRoot } from "./lib.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

if (process.env.ARBITER_PLAN_BYPASS === "1") process.exit(0);

const root = getRepoRoot();
const { phase, plan } = readTaskState(root);

if (phase !== "implementation") process.exit(0);

// During implementation, plan is required
const planPath =
  !plan || plan === "unknown"
    ? null
    : plan.startsWith("/")
      ? plan
      : join(root, plan);

if (!planPath || !existsSync(planPath)) {
  process.stderr.write(
    `[arbiter] PLAN ANCHOR: implementation phase requires .task-plan pointing to an existing plan file.\n` +
      `Set via: echo "<path>" > .claude/.task-plan (or use ARBITER_PLAN_BYPASS=1 for emergency edits)\n`,
  );
  process.exit(2);
}

const lines = readFileSync(planPath, "utf-8")
  .split("\n")
  .slice(0, 20)
  .join("\n");

process.stdout.write(
  `=== ACTIVE PLAN (${basename(planPath)}) ===\n` + `${lines}\n` + `===\n`,
);
