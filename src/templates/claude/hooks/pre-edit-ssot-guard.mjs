#!/usr/bin/env node
// Arbiter hook: hard-block edits to governance/SSOT documents
// Fires on: PreToolUse → Edit|Write
// Exit 2: block (Claude Code asks user for explicit approval)
// Bypass: ARBITER_SSOT_BYPASS=1 (session-scoped — see CONTRIBUTING.md)
const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? "";

if (process.env.ARBITER_SSOT_BYPASS === "1") process.exit(0);

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
      `[arbiter] SSOT GUARD: ${file} is a high-authority governance document.\n` +
        `Editing requires explicit ADR or amendment. Set ARBITER_SSOT_BYPASS=1 for legitimate edits.\n`,
    );
    process.exit(2);
  }
}
