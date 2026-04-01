import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { renderTemplate } from "../utils/render.js";
import { writeFile, mergeSettingsJson, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ClaudeGeneratorResult {
  files: WriteResult[];
}

export function generateClaude(config: ProjectConfig): ClaudeGeneratorResult {
  const results: WriteResult[] = [];
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  // CLAUDE.md — always rewrite (thin pointer)
  results.push(
    writeFile(
      resolvedPath(base, ".claude", "CLAUDE.md"),
      renderTemplate("claude/CLAUDE.md.ejs", data),
      { backup: true },
    ),
  );

  // settings.json — deep merge if exists, create if not
  const settingsPath = resolvedPath(base, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    const existing = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const incoming = JSON.parse(
      renderTemplate("claude/settings.json.ejs", data),
    ) as Record<string, unknown>;
    const merged = mergeSettingsJson(existing, incoming);
    writeFileSync(
      settingsPath,
      JSON.stringify(merged, null, 2) + "\n",
      "utf-8",
    );
    results.push({ path: settingsPath, action: "backed-up-and-replaced" });
  } else {
    results.push(
      writeFile(settingsPath, renderTemplate("claude/settings.json.ejs", data)),
    );
  }

  // Hook scripts — skip if already exists
  const hooksDir = resolvedPath(base, ".claude", "hooks");
  mkdirSync(hooksDir, { recursive: true });

  const staticHooks = [
    "stop-dangerous.sh",
    "enforce-read-only.sh",
    "pre-edit-ssot-guard.sh",
    "check-no-orphan-todo.sh",
  ];
  for (const hookFile of staticHooks) {
    results.push(
      writeFile(
        join(hooksDir, hookFile),
        renderTemplate(`claude/hooks/${hookFile}`, data),
        { skipIfExists: true },
      ),
    );
  }

  results.push(
    writeFile(
      join(hooksDir, "lib.sh"),
      renderTemplate("claude/hooks/lib.sh.ejs", data),
      { skipIfExists: true },
    ),
  );
  results.push(
    writeFile(
      join(hooksDir, "post-commit-check.sh"),
      renderTemplate("claude/hooks/post-commit-check.sh.ejs", data),
      { skipIfExists: true },
    ),
  );

  // Language-specific hook scripts
  for (const hook of config.languageHooks) {
    if (hook.name !== "check-no-orphan-todo.sh") {
      const body = hook.body.startsWith("#!/")
        ? hook.body
        : `#!/usr/bin/env bash\n${hook.body}`;
      results.push(
        writeFile(join(hooksDir, hook.name), body, { skipIfExists: true }),
      );
    }
  }

  // Rules — skip if exists
  const rulesDir = resolvedPath(base, ".claude", "rules");
  const rules = [
    {
      file: "05-agent-lifecycle.md",
      template: "claude/rules/05-agent-lifecycle.md",
    },
    {
      file: "25-todo-folder-policy.md",
      template: "claude/rules/25-todo-folder-policy.md",
    },
    {
      file: "90-exec-protocol.md",
      template: "claude/rules/90-exec-protocol.md.ejs",
    },
  ];
  for (const rule of rules) {
    results.push(
      writeFile(
        join(rulesDir, rule.file),
        renderTemplate(rule.template, data),
        { skipIfExists: true },
      ),
    );
  }

  // Commands — skip if exists
  const commandsDir = resolvedPath(base, ".claude", "commands");
  const commands = ["start-task.md", "complete-task.md"];
  for (const cmd of commands) {
    results.push(
      writeFile(
        join(commandsDir, cmd),
        renderTemplate(`claude/commands/${cmd}`, data),
        { skipIfExists: true },
      ),
    );
  }

  // Make hook scripts executable (best effort)
  chmodHooks(hooksDir);

  return { files: results };
}

function chmodHooks(dir: string): void {
  try {
    execFileSync("bash", ["-c", `chmod +x "${dir}"/*.sh`], { stdio: "ignore" });
  } catch {
    // Non-fatal — chmod is best effort
  }
}
