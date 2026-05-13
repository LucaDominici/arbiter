import { runCli, runCliJson } from "../utils/run-cli.js";

export interface ProjectBoardResult {
  created: boolean;
  projectUrl: string | null;
  error: string | null;
  warnings: string[];
}

interface GhProject {
  number: number;
  title: string;
  url: string;
}

interface GhField {
  name: string;
}

function findExistingBoard(
  owner: string,
  title: string,
): { number: number; url: string } | null {
  try {
    const { projects } = runCliJson("gh", [
      "project",
      "list",
      "--owner",
      owner,
      "--format",
      "json",
      "--limit",
      "100",
    ]) as { projects: GhProject[] };
    const match = projects.find((p) => p.title === title);
    return match ? { number: match.number, url: match.url } : null;
  } catch {
    return null;
  }
}

function existingFieldNames(owner: string, projectNumber: number): Set<string> {
  try {
    const { fields } = runCliJson("gh", [
      "project",
      "field-list",
      String(projectNumber),
      "--owner",
      owner,
      "--format",
      "json",
    ]) as { fields: GhField[] };
    return new Set(fields.map((f) => f.name));
  } catch {
    return new Set();
  }
}

interface FieldSpec {
  name: string;
  options: string;
}

function ensureField(
  projectNumber: number,
  owner: string,
  spec: FieldSpec,
  existingNames: Set<string>,
  warnings: string[],
): void {
  if (existingNames.has(spec.name)) return;
  try {
    runCli("gh", [
      "project",
      "field-create",
      String(projectNumber),
      "--owner",
      owner,
      "--name",
      spec.name,
      "--data-type",
      "SINGLE_SELECT",
      "--single-select-options",
      spec.options,
    ]);
  } catch (err) {
    warnings.push(
      `${spec.name} field: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Create a GitHub Project board with standard fields (Priority, Size).
 * Idempotent: reuses an existing board with the same title rather than
 * creating a duplicate. Requires `gh` CLI with project scope.
 */
export function createProjectBoard(
  owner: string,
  repo: string,
): ProjectBoardResult {
  const boardTitle = `${repo} Board`;
  const warnings: string[] = [];

  const existing = findExistingBoard(owner, boardTitle);
  if (existing) {
    const fieldNames = existingFieldNames(owner, existing.number);
    ensureField(
      existing.number,
      owner,
      { name: "Priority", options: "P0,P1,P2" },
      fieldNames,
      warnings,
    );
    ensureField(
      existing.number,
      owner,
      { name: "Size", options: "XS,S,M,L" },
      fieldNames,
      warnings,
    );
    return { created: false, projectUrl: existing.url, error: null, warnings };
  }

  let projectNumber: number;
  let projectUrl: string;
  try {
    const parsed = runCliJson("gh", [
      "project",
      "create",
      "--owner",
      owner,
      "--title",
      boardTitle,
      "--format",
      "json",
    ]) as { number: number; url: string };
    projectNumber = parsed.number;
    projectUrl = parsed.url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { created: false, projectUrl: null, error: msg, warnings: [] };
  }

  const fieldNames = existingFieldNames(owner, projectNumber);
  ensureField(
    projectNumber,
    owner,
    { name: "Priority", options: "P0,P1,P2" },
    fieldNames,
    warnings,
  );
  ensureField(
    projectNumber,
    owner,
    { name: "Size", options: "XS,S,M,L" },
    fieldNames,
    warnings,
  );

  return { created: true, projectUrl, error: null, warnings };
}
