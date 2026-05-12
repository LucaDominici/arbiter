#!/usr/bin/env node
// Arbiter hook: block non-conventional commit messages after git commit (INV-22)
// Fires on: PostToolUse → Bash
import { spawnSync } from "node:child_process";

const command = process.env.CLAUDE_TOOL_INPUT_COMMAND ?? "";

// Only act on git commit commands
if (!/^git commit/.test(command)) process.exit(0);

// Get last commit message
const result = spawnSync("git", ["log", "-1", "--format=%s"], {
  encoding: "utf-8",
});
const msg = (result.stdout ?? "").trim();

// git log failed or no commits yet — skip check
if (result.status !== 0 || !msg) process.exit(0);

// Check conventional commit format: type(scope): summary
const CONVENTIONAL =
  /^(feat|fix|refactor|test|docs|ci|chore|perf|style|build|revert)(\([^)]+\))?: .{1,72}$/;
if (!CONVENTIONAL.test(msg)) {
  process.stderr.write(
    `[arbiter] INV-22: Commit message does not follow convention: ${msg}\n`,
  );
  process.stderr.write(
    `[arbiter] Expected: type(scope): summary (e.g., feat(auth): add login)\n`,
  );
  process.exit(1);
}
