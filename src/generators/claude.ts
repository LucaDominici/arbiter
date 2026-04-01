import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
    "stop-dangerous.mjs",
    "enforce-read-only.mjs",
    "pre-edit-ssot-guard.mjs",
    "check-no-orphan-todo.mjs",
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
      join(hooksDir, "lib.mjs"),
      renderTemplate("claude/hooks/lib.mjs.ejs", data),
      { skipIfExists: true },
    ),
  );
  results.push(
    writeFile(
      join(hooksDir, "post-commit-check.mjs"),
      renderTemplate("claude/hooks/post-commit-check.mjs.ejs", data),
      { skipIfExists: true },
    ),
  );

  // Language-specific hook scripts
  for (const hook of config.languageHooks) {
    if (hook.name !== "check-no-orphan-todo.mjs") {
      results.push(
        writeFile(join(hooksDir, hook.name), hook.body, { skipIfExists: true }),
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

  // Commands — skip if exists (EJS templates, stack-parameterized)
  const commandsDir = resolvedPath(base, ".claude", "commands");
  const commands = ["start-task.md", "complete-task.md"];
  for (const cmd of commands) {
    results.push(
      writeFile(
        join(commandsDir, cmd),
        renderTemplate(`claude/commands/${cmd}.ejs`, data),
        { skipIfExists: true },
      ),
    );
  }

  return { files: results };
}
