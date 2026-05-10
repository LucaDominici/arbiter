#!/usr/bin/env node
// Codex CLI hook adapter — bridges Codex stdin-JSON payload to Claude Code hooks.
// Usage: node .codex/codex-adapter.mjs <hook-path>
// Codex delivers hook input on stdin as JSON; Claude Code hooks read env vars.
// This adapter translates the payload then delegates to the target hook.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const hookPath = process.argv[2];
if (!hookPath) {
  process.stderr.write(
    "[codex-adapter] FATAL: no hook path provided as argument.\n" +
      "Usage: node .codex/codex-adapter.mjs <hook-path>\n" +
      "Check .codex/config.toml for correct hook command wiring.\n",
  );
  process.exit(2);
}

let raw = "";
try {
  raw = readFileSync(0, "utf-8").trim();
} catch (err) {
  process.stderr.write(
    `[codex-adapter] failed to read stdin payload: ${String(err)}\n`,
  );
  process.exit(0);
}

if (!raw) process.exit(0);

let payload;
try {
  payload = JSON.parse(raw);
} catch (err) {
  process.stderr.write(
    `[codex-adapter] failed to parse stdin as JSON: ${String(err)}\n`,
  );
  process.exit(0);
}

const toolName = payload?.tool_name ?? "";
const toolInput = payload?.tool_input ?? {};
const env = { ...process.env };

function runHook(hookEnv) {
  try {
    execFileSync("node", [hookPath], { env: hookEnv, stdio: "inherit" });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      if (typeof err.status === "number") process.exit(err.status);
      // null status: hook was killed by signal or timed out — hard block
      process.stderr.write(
        `[codex-adapter] hook '${hookPath}' was killed by signal (status=null)\n`,
      );
      process.exit(2);
    }
    process.stderr.write(
      `[codex-adapter] unexpected error spawning hook: ${String(err)}\n`,
    );
    process.exit(2);
  }
}

// Extract file paths or command depending on tool
if (toolName === "apply_patch") {
  // tool_input.command is a unified diff; extract file paths from directive lines.
  // "Move to:" captures the rename destination so SSOT/read-only guards check the target.
  const patchBody = toolInput.command ?? "";
  const filePaths = [];
  for (const line of patchBody.split("\n")) {
    const m = line.match(
      /^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/,
    );
    if (m) filePaths.push(m[1].trim());
  }

  if (filePaths.length === 0) process.exit(0);

  // Run the hook once per file; propagate first non-zero exit code
  for (const filePath of filePaths) {
    runHook({ ...env, CLAUDE_TOOL_INPUT_PATH: filePath });
  }
  process.exit(0);
}

if (toolName === "bash") {
  const command = toolInput.command ?? "";
  if (!command) process.exit(0);
  runHook({ ...env, CLAUDE_TOOL_INPUT_COMMAND: command });
  process.exit(0);
}

// Unknown tool — no-op
process.exit(0);
