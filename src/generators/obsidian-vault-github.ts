import { renderTemplate } from "../utils/render.js";
import { resolvedPath } from "../utils/fs.js";
import {
  DEFAULT_VAULT_OPTIONS,
  writeVaultOutput,
  type ObsidianVaultOptions,
} from "./obsidian-vault-io.js";
import * as ghFetcher from "./obsidian-vault-github-fetch.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface GithubVaultNotesResult {
  files: WriteResult[];
}

export function generateGithubVaultNotes(
  config: ProjectConfig,
  opts: ObsidianVaultOptions = DEFAULT_VAULT_OPTIONS,
): GithubVaultNotesResult {
  if (!config.useGitHub) return { files: [] };

  const base = resolvedPath(config.targetDir, "docs", "vault");
  const data = ghFetcher.fetchGithubData(config.githubOwner, config.githubRepo);

  const files: WriteResult[] = [];

  files.push(
    writeVaultOutput(
      resolvedPath(base, "github", "open-issues.md"),
      renderTemplate("obsidian-vault/github/open-issues.md.ejs", {
        ...data,
      } as unknown as Record<string, unknown>),
      opts,
    ),
  );

  files.push(
    writeVaultOutput(
      resolvedPath(base, "github", "labels.md"),
      renderTemplate("obsidian-vault/github/labels.md.ejs", {
        ...data,
      } as unknown as Record<string, unknown>),
      opts,
    ),
  );

  if (data.available) {
    for (const issue of data.issues) {
      files.push(
        writeVaultOutput(
          resolvedPath(base, "github", "issues", `${issue.number}.md`),
          renderTemplate("obsidian-vault/github/issues/issue.md.ejs", {
            issue,
          } as unknown as Record<string, unknown>),
          opts,
        ),
      );
    }
  }

  return { files };
}
