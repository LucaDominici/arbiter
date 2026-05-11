/**
 * Label generator for GitHub-backed task tiers (#237).
 *
 * Emits `gh label create size:XS|S|Standard` commands. Used by `arbiter init`
 * when useGitHub is true and the labels aren't already present.
 *
 * Idempotent via `--force` (gh updates existing labels rather than failing).
 */

export interface LabelSpec {
  name: string;
  description: string;
  /** Hex color without leading "#". */
  color: string;
}

export const TIER_LABELS: readonly LabelSpec[] = [
  {
    name: "size:XS",
    description: "Tiny task — single file, minimal plan, 3 review agents",
    color: "c2e0c6",
  },
  {
    name: "size:S",
    description: "Small task — 2–5 files, brief plan, 3 review agents",
    color: "fef2c0",
  },
  {
    name: "size:Standard",
    description: "Standard task — multi-file, full plan, 4 review agents",
    color: "fbca04",
  },
] as const;

/**
 * Build the shell commands needed to install task-tier labels in a GitHub repo.
 * Returns one command string per label.
 */
export function generateLabelCommands(): string[] {
  return TIER_LABELS.map(
    (label) =>
      `gh label create "${label.name}" --color "${label.color}" --description "${label.description}" --force`,
  );
}
