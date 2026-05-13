import { runCli, runCliJson } from "../utils/run-cli.js";
import { TASK_SIZE_LABELS } from "../generators/labels.js";

export interface Label {
  name: string;
  color: string;
  description: string;
}

/**
 * Canonical project labels. Task-size labels use the `size:` colon
 * convention (e.g. `size:XS`) — see #237. We deliberately do NOT ship a
 * parallel `size/*` slash taxonomy: one shape avoids the "which one do
 * I pick" confusion that exists in many starter repos.
 */
const STANDARD_LABELS: Label[] = [
  { name: "bug", color: "d73a4a", description: "Something isn't working" },
  { name: "feature", color: "a2eeef", description: "New feature or request" },
  { name: "task", color: "0075ca", description: "Implementation task" },
  { name: "docs", color: "0075ca", description: "Documentation only" },
  { name: "refactor", color: "e4e669", description: "Code refactoring" },
  { name: "test", color: "fbca04", description: "Test additions or fixes" },
  { name: "ci", color: "bfd4f2", description: "CI/CD changes" },
  { name: "deps", color: "0366d6", description: "Dependency updates" },
  {
    name: "priority/P0",
    color: "b60205",
    description: "Critical — drop everything",
  },
  { name: "priority/P1", color: "ff9f1c", description: "High — next up" },
  { name: "priority/P2", color: "fbca04", description: "Normal — in backlog" },
  // Task-size labels (#237) — used by /task to pick plan depth + reviewer count.
  ...TASK_SIZE_LABELS.map((l) => ({
    name: l.name,
    color: l.color,
    description: l.description,
  })),
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

  // Fetch existing labels once — paginated to avoid truncation on large repos
  let existingNames: Set<string>;
  try {
    const parsed = runCliJson("gh", [
      "api",
      `repos/${owner}/${repo}/labels`,
      "--paginate",
    ]) as Array<{ name: string }>;
    existingNames = new Set(parsed.map((l) => l.name.toLowerCase()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`list labels failed: ${msg}`);
    existingNames = new Set();
  }

  for (const label of STANDARD_LABELS) {
    try {
      if (existingNames.has(label.name.toLowerCase())) {
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
