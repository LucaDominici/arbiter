#!/usr/bin/env node
// Arbiter hook: block dangerous bash commands
// Fires on: PreToolUse → Bash
const command = process.env.CLAUDE_TOOL_INPUT_COMMAND ?? "";

const DANGEROUS_PATTERNS = [
  "rm -rf /",
  "rm -rf ~",
  "git push --force",
  "git push -f ",
  "git reset --hard",
  "DROP TABLE",
  "DROP DATABASE",
  "sudo rm",
  "> /dev/sda",
];

for (const pattern of DANGEROUS_PATTERNS) {
  if (command.includes(pattern)) {
    process.stderr.write(`[arbiter] Blocked dangerous command: ${command}\n`);
    process.exit(1);
  }
}
