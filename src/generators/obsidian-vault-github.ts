import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import * as ghFetcher from "./obsidian-vault-github-fetch.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface GithubVaultNotesResult {
  files: WriteResult[];
}

export function generateGithubVaultNotes(
  config: ProjectConfig,
): GithubVaultNotesResult {
  if (!config.useGitHub) return { files: [] };

  const base = resolvedPath(config.targetDir, "docs", "vault");
  const data = ghFetcher.fetchGithubData(config.githubOwner, config.githubRepo);

  const files: WriteResult[] = [];

  files.push(
    writeFile(
      resolvedPath(base, "github", "open-issues.md"),
      renderTemplate("obsidian-vault/github/open-issues.md.ejs", {
        ...data,
      } as unknown as Record<string, unknown>),
      { skipIfExists: false },
    ),
  );

  files.push(
    writeFile(
      resolvedPath(base, "github", "labels.md"),
      renderTemplate("obsidian-vault/github/labels.md.ejs", {
        ...data,
      } as unknown as Record<string, unknown>),
      { skipIfExists: false },
    ),
  );

  if (data.available) {
    for (const issue of data.issues) {
      files.push(
        writeFile(
          resolvedPath(base, "github", "issues", `${issue.number}.md`),
          renderTemplate("obsidian-vault/github/issues/issue.md.ejs", {
            issue,
          } as unknown as Record<string, unknown>),
          { skipIfExists: false },
        ),
      );
    }
  }

  return { files };
}
