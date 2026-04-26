#!/usr/bin/env node
// Arbiter hook: warn on premature task-completion claims
// Hook type: UserPromptSubmit — fires before every user prompt
// Non-blocking (exit 0) — advisory only
// Reads .claude/.task-phase + prompt to detect early "complete" declarations
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function getRepoRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  });
  if (result.status === 0 && result.stdout) return result.stdout.trim();
  return process.cwd();
}

function readTaskState(root) {
  function read(file) {
    const p = join(root, ".claude", file);
    if (!existsSync(p)) return "unknown";
    return readFileSync(p, "utf-8").trim() || "unknown";
  }
  return {
    taskId: read(".task-id"),
    phase: read(".task-phase"),
    tier: read(".task-tier"),
  };
}

function readAgentsDispatched(root) {
  const p = join(root, ".agents-dispatched");
  if (!existsSync(p)) return 0;
  try {
    return parseInt(readFileSync(p, "utf-8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

const root = getRepoRoot();
const { phase, tier } = readTaskState(root);

// Only guard during implementation or verification phase
if (phase !== "implementation" && phase !== "verification") process.exit(0);

// Read user prompt from stdin (UserPromptSubmit JSON protocol)
let promptText = "";
try {
  const raw = readFileSync(0, "utf-8");
  promptText = JSON.parse(raw)?.prompt ?? "";
} catch {
  process.exit(0); // Can't read prompt — skip
}

// Completion claim patterns
const COMPLETION_PATTERNS =
  /\b(task complete|task completed|all phases complete|pr merged|merged to main|wrapping up|ready to (merge|close))\b/i;
if (!COMPLETION_PATTERNS.test(promptText)) process.exit(0);

// Completion claimed but phase is not complete — check evidence
const dispatched = readAgentsDispatched(root);
const minRequired = tier === "Standard" ? 4 : 3;

const warnings = [];
if (dispatched < minRequired) {
  warnings.push(
    `- agents-dispatched: ${dispatched} (minimum ${minRequired} for tier ${tier})`,
  );
}

process.stdout.write(
  `━━━ COMPLETION GUARD ━━━\n` +
    `Claimed task complete, but phase=${phase}\n` +
    (warnings.length
      ? `Missing evidence:\n${warnings.join("\n")}\n\nAction: run code review phases before claiming completion. Gate: node scripts/check-all.mjs L2\n`
      : `Evidence OK. Proceed with: node scripts/check-all.mjs L2\n`) +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
);
