#!/usr/bin/env node
// Arbiter hook: preserve session state across context compaction
// Hook type: PreCompact — fires before automatic context compaction
// stdout is injected as context the model sees immediately after compaction
// Always exits 0 (non-blocking)
import { readTaskState, getRepoRoot } from "./lib.mjs";
import { spawnSync } from "node:child_process";

const root = getRepoRoot();
const state = readTaskState(root);

const branch =
  spawnSync("git", ["branch", "--show-current"], {
    encoding: "utf-8",
    cwd: root,
  }).stdout?.trim() ?? "unknown";

process.stdout.write(
  `━━━ SESSION STATE (preserved across compaction) ━━━\n` +
    `Branch : ${branch}\n` +
    `Task   : ${state.taskId}\n` +
    `Tier   : ${state.tier}\n` +
    `Phase  : ${state.phase}\n` +
    `Plan   : ${state.plan}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `IMPORTANT: Context was compacted. Resume work from the phase/step above.\n` +
    `Re-read AGENTS.md if branch/task/phase are "unknown".\n`,
);
