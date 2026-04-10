import { runCli, runCliJson } from "../utils/run-cli.js";

export interface Label {
  name: string;
  color: string;
  description: string;
}

const STANDARD_LABELS: Label[] = [
  { name: "bug", color: "d73a4a", description: "Something isn't working" },
  { name: "feature", color: "a2eeef", description: "New feature or request" },
  { name: "task", color: "0075ca", description: "Implementation task" },
  { name: "docs", color: "0075ca", description: "Documentation only" },
  { name: "refactor", color: "e4e669", description: "Code refactoring" },
  { name: "test", color: "fbca04", description: "Test additions or fixes" },
  { name: "ci", color: "bfd4f2", description: "CI/CD changes" },
  { name: "deps", color: "0366d6", description: "Dependency updates" },
  { name: "size/XS", color: "c2e0c6", description: "< 30 min" },
  { name: "size/S", color: "c2e0c6", description: "30 min — 2 hours" },
  { name: "size/M", color: "fef2c0", description: "2 — 8 hours" },
  { name: "size/L", color: "f9d0c4", description: "1 — 3 days" },
  {
    name: "priority/P0",
    color: "b60205",
    description: "Critical — drop everything",
  },
  { name: "priority/P1", color: "ff9f1c", description: "High — next up" },
  { name: "priority/P2", color: "fbca04", description: "Normal — in backlog" },
];

export interface LabelProvisionResult {
  created: string[];
  updated: string[];
  skipped: string[];
  errors: string[];
}

export function provisionLabels(
  owner: string,
  repo: string,
): LabelProvisionResult {
  const result: LabelProvisionResult = {
    created: [],
    updated: [],
    skipped: [],
    errors: [],
  };

  // Fetch existing labels once
  let existingNames: Set<string>;
  try {
    const parsed = runCliJson("gh", [
      "label",
      "list",
      "-R",
      `${owner}/${repo}`,
      "--json",
      "name",
      "--limit",
      "200",
    ]) as Array<{ name: string }>;
    existingNames = new Set(parsed.map((l) => l.name));
  } catch {
    existingNames = new Set();
  }

  for (const label of STANDARD_LABELS) {
    try {
      if (existingNames.has(label.name)) {
        // Update existing to ensure color/description are current
        runCli("gh", [
          "label",
          "edit",
          label.name,
          "-R",
          `${owner}/${repo}`,
          "--color",
          label.color,
          "--description",
          label.description,
        ]);
        result.updated.push(label.name);
      } else {
        runCli("gh", [
          "label",
          "create",
          label.name,
          "-R",
          `${owner}/${repo}`,
          "--color",
          label.color,
          "--description",
          label.description,
        ]);
        result.created.push(label.name);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${label.name}: ${msg}`);
    }
  }

  return result;
}
