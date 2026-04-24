import { runCli, CliError } from "../utils/run-cli.js";

export interface GhIssueRecord {
  number: number;
  title: string;
  state: string;
  labels: string[];
  url: string;
  invariants: string[];
}

export interface GhLabelRecord {
  name: string;
  invariant: string | null;
}

export interface GithubData {
  available: boolean;
  issues: GhIssueRecord[];
  labels: GhLabelRecord[];
}

interface RawIssue {
  number: number;
  title: string;
  state: string;
  labels: { name: string }[];
  url: string;
}

interface RawLabel {
  name: string;
}

const GH_TIMEOUT_MS = 10_000;

function labelToInvariant(label: string): string | null {
  const m = label.match(/^inv-(\d+)$/i);
  if (!m) return null;
  return `INV-${(m[1] ?? "").padStart(2, "0")}`;
}

function runGh(args: string[], tag: string): string | null {
  try {
    return runCli("gh", args, { timeoutMs: GH_TIMEOUT_MS }).stdout;
  } catch (err) {
    if (err instanceof CliError) {
      const preview = (err.stderr || err.stdout || err.message)
        .trim()
        .slice(0, 200);
      if (err.notFound) {
        process.stderr.write(
          `[obsidian-vault-github] gh not installed (${tag})\n`,
        );
      } else if (err.timedOut) {
        process.stderr.write(
          `[obsidian-vault-github] gh ${tag} timeout (${GH_TIMEOUT_MS}ms)\n`,
        );
      } else {
        process.stderr.write(
          `[obsidian-vault-github] gh ${tag} failed (exit ${err.exitCode}): ${preview}\n`,
        );
      }
      return null;
    }
    throw err;
  }
}

function isRawIssueArray(value: unknown): value is RawIssue[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const first = value[0] as Record<string, unknown>;
  return (
    typeof first.number === "number" &&
    typeof first.title === "string" &&
    typeof first.state === "string" &&
    typeof first.url === "string" &&
    Array.isArray(first.labels)
  );
}

function isRawLabelArray(value: unknown): value is RawLabel[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const first = value[0] as Record<string, unknown>;
  return typeof first.name === "string";
}

function parseJsonOrNull<T>(
  raw: string,
  tag: string,
  guard: (v: unknown) => v is T,
): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `[obsidian-vault-github] gh ${tag} emitted non-JSON: ${(err as Error).message}\n`,
    );
    return null;
  }
  if (!guard(parsed)) {
    process.stderr.write(
      `[obsidian-vault-github] gh ${tag} JSON shape rejected by guard\n`,
    );
    return null;
  }
  return parsed;
}

export function fetchGithubData(
  owner: string | null,
  repo: string | null,
): GithubData {
  if (!owner || !repo) return { available: false, issues: [], labels: [] };

  const issuesRaw = runGh(
    [
      "issue",
      "list",
      "--repo",
      `${owner}/${repo}`,
      "--state",
      "open",
      "--json",
      "number,title,state,labels,url",
      "--limit",
      "100",
    ],
    "issue list",
  );
  const labelsRaw = runGh(
    [
      "label",
      "list",
      "--repo",
      `${owner}/${repo}`,
      "--json",
      "name",
      "--limit",
      "200",
    ],
    "label list",
  );

  if (issuesRaw === null || labelsRaw === null) {
    return { available: false, issues: [], labels: [] };
  }

  const rawIssues = parseJsonOrNull(issuesRaw, "issue list", isRawIssueArray);
  const rawLabels = parseJsonOrNull(labelsRaw, "label list", isRawLabelArray);

  if (rawIssues === null || rawLabels === null) {
    return { available: false, issues: [], labels: [] };
  }

  const issues = rawIssues.map((i) => {
    const labelNames = i.labels.map((l) => l.name);
    const invariants = labelNames
      .map(labelToInvariant)
      .filter((x): x is string => x !== null);
    return {
      number: i.number,
      title: i.title,
      state: i.state,
      labels: labelNames,
      url: i.url,
      invariants,
    };
  });

  const labels = rawLabels.map((l) => ({
    name: l.name,
    invariant: labelToInvariant(l.name),
  }));

  return { available: true, issues, labels };
}
