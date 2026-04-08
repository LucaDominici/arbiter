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

  generateClaudeSettings(base, data, results);
  generateClaudeHooks(base, data, config, results);
  generateClaudeRules(base, data, results);
  generateClaudeCommands(base, data, results);

  return { files: results };
}

function generateClaudeSettings(
  base: string,
  data: Record<string, unknown>,
  results: WriteResult[],
): void {
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
}

function generateClaudeHooks(
  base: string,
  data: Record<string, unknown>,
  config: ProjectConfig,
  results: WriteResult[],
): void {
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

  for (const hook of config.languageHooks) {
    if (hook.name !== "check-no-orphan-todo.mjs") {
      results.push(
        writeFile(join(hooksDir, hook.name), hook.body, { skipIfExists: true }),
      );
    }
  }
}

function generateClaudeRules(
  base: string,
  data: Record<string, unknown>,
  results: WriteResult[],
): void {
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
}

function generateClaudeCommands(
  base: string,
  data: Record<string, unknown>,
  results: WriteResult[],
): void {
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
}
