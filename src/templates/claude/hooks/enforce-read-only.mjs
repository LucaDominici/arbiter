#!/usr/bin/env node
// Arbiter hook: guard designated read-only files
// Fires on: PreToolUse → Edit|Write
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? "";

const READ_ONLY_PATTERNS = [
  "AGENTS.md",
  "LICENSE",
  "package-lock.json",
  "Cargo.lock",
];

for (const pattern of READ_ONLY_PATTERNS) {
  if (file.includes(pattern)) {
    process.stderr.write(
      `[arbiter] Read-only file — edit requires explicit justification: ${file}\n`,
    );
    process.exit(1);
  }
}
