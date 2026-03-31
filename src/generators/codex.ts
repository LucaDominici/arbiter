import { join } from 'node:path';
import { renderTemplate } from '../utils/render.js';
import { writeFile, resolvedPath } from '../utils/fs.js';
import type { ProjectConfig } from '../wizard/types.js';
import type { WriteResult } from '../utils/fs.js';

export interface CodexGeneratorResult {
  files: WriteResult[];
}

export function generateCodex(config: ProjectConfig): CodexGeneratorResult {
  const results: WriteResult[] = [];
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  // CODEX.md — thin pointer + Codex-specific config
  results.push(writeFile(
    resolvedPath(base, '.agents', 'CODEX.md'),
    renderTemplate('codex/CODEX.md.ejs', data),
    { backup: true },
  ));

  // Rules mirror — same as .claude/rules/ (skip if exists)
  const rulesDir = resolvedPath(base, '.agents', 'rules');
  const rules = [
    { file: '05-agent-lifecycle.md', template: 'codex/rules/05-agent-lifecycle.md' },
    { file: '25-todo-folder-policy.md', template: 'codex/rules/25-todo-folder-policy.md' },
    { file: '90-exec-protocol.md', template: 'codex/rules/90-exec-protocol.md.ejs' },
  ];
  for (const rule of rules) {
    results.push(writeFile(join(rulesDir, rule.file), renderTemplate(rule.template, data), { skipIfExists: true }));
  }

  // Plan directory scaffold
  const planDir = resolvedPath(base, '.agents', 'plan');
  results.push(writeFile(join(planDir, 'README.md'), PLAN_README, { skipIfExists: true }));

  return { files: results };
}

const PLAN_README = `# .agents/plan/

Task plan artifacts for Codex execution.

## Files

- \`PLAN.json\` — current task plan (created by Codex before implementation)
- \`CONTEXT_PACK.md\` — context digest for the current task
- \`runs/\` — historical run snapshots

## Plan Schema

See \`.agents/CODEX.md\` §Plan Schema for the required format.
`;
