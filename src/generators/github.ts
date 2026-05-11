import { join } from "node:path";
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface GithubGeneratorResult {
  files: WriteResult[];
}

export function generateGithub(config: ProjectConfig): GithubGeneratorResult {
  const results: WriteResult[] = [];
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;
  const githubDir = resolvedPath(base, ".github");

  // CI workflow — skip if exists (may be customized)
  const workflowsDir = join(githubDir, "workflows");
  results.push(
    writeFile(
      join(workflowsDir, "ci.yml"),
      renderTemplate("github/workflows/ci.yml.ejs", data),
      { skipIfExists: true },
    ),
  );

  // PR template — skip if exists
  results.push(
    writeFile(
      join(githubDir, "PULL_REQUEST_TEMPLATE.md"),
      renderTemplate("github/PULL_REQUEST_TEMPLATE.md", data),
      { skipIfExists: true },
    ),
  );

  // Issue templates — skip if exists
  const issueTemplatesDir = join(githubDir, "ISSUE_TEMPLATE");

  // task-brief is EJS (governance-gated sections) — rendered separately
  results.push(
    writeFile(
      join(issueTemplatesDir, "task-brief.yml"),
      renderTemplate("github/issue-templates/task-brief.yml.ejs", data),
      { skipIfExists: true },
    ),
  );

  const issueTemplates = [
    "bug-report.yml",
    "feature-request.yml",
    "epic.yml",
    "config.yml",
  ];
  for (const tpl of issueTemplates) {
    results.push(
      writeFile(
        join(issueTemplatesDir, tpl),
        renderTemplate(`github/issue-templates/${tpl}`, data),
        { skipIfExists: true },
      ),
    );
  }

  if (config.governanceLevel !== "L1") {
    results.push(
      writeFile(
        join(issueTemplatesDir, "compliance-item.yml"),
        renderTemplate("github/issue-templates/compliance-item.yml.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  // Issue state automation — skip if exists
  results.push(
    writeFile(
      join(workflowsDir, "issue-state.yml"),
      renderTemplate("github/workflows/issue-state.yml.ejs", data),
      { skipIfExists: true },
    ),
  );

  // Dependabot — skip if exists
  results.push(
    writeFile(
      join(githubDir, "dependabot.yml"),
      renderTemplate("github/dependabot.yml.ejs", data),
      { skipIfExists: true },
    ),
  );

  return { files: results };
}
