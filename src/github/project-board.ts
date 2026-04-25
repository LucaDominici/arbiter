import { runCli, runCliJson } from "../utils/run-cli.js";

export interface ProjectBoardResult {
  created: boolean;
  projectUrl: string | null;
  error: string | null;
  warnings: string[];
}

/**
 * Create a GitHub Project board with standard fields (Priority, Size).
 * Requires `gh` CLI with project scope. Fails gracefully if unavailable.
 */
export function createProjectBoard(
  owner: string,
  repo: string,
): ProjectBoardResult {
  // Create the project
  const warnings: string[] = [];
  let projectNumber: number;
  let projectUrl: string;
  try {
    const parsed = runCliJson("gh", [
      "project",
      "create",
      "--owner",
      owner,
      "--title",
      `${repo} Board`,
      "--format",
      "json",
    ]) as { number: number; url: string };
    projectNumber = parsed.number;
    projectUrl = parsed.url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { created: false, projectUrl: null, error: msg, warnings: [] };
  }

  // Add Priority field
  try {
    runCli("gh", [
      "project",
      "field-create",
      String(projectNumber),
      "--owner",
      owner,
      "--name",
      "Priority",
      "--data-type",
      "SINGLE_SELECT",
      "--single-select-options",
      "P0,P1,P2",
    ]);
  } catch (err) {
    warnings.push(
      `Priority field: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Add Size field
  try {
    runCli("gh", [
      "project",
      "field-create",
      String(projectNumber),
      "--owner",
      owner,
      "--name",
      "Size",
      "--data-type",
      "SINGLE_SELECT",
      "--single-select-options",
      "XS,S,M,L",
    ]);
  } catch (err) {
    warnings.push(
      `Size field: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { created: true, projectUrl, error: null, warnings };
}
