#!/usr/bin/env node
// Arbiter hook: warn when editing governance/SSOT documents
// Fires on: PreToolUse → Edit|Write
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? "";

// Only enforce on files within this repo
const repoRoot = process.cwd();
if (file && !file.startsWith(repoRoot)) process.exit(0);

const SSOT_PATTERNS = [
  "AGENTS.md",
  ".claude/CLAUDE.md",
  ".agents/CODEX.md",
  "docs/METHOD/",
  "docs/SYSTEM/DECISIONS",
];

for (const pattern of SSOT_PATTERNS) {
  if (file.includes(pattern)) {
    process.stderr.write(
      `[arbiter] SSOT guard: editing governance file — ensure change is intentional: ${file}\n`,
    );
    // Warning only, not blocking
  }
}
