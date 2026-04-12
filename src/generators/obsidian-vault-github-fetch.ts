import { execFileSync } from "node:child_process";

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

function labelToInvariant(label: string): string | null {
  const m = label.match(/^inv-(\d+)$/i);
  if (!m) return null;
  return `INV-${(m[1] ?? "").padStart(2, "0")}`;
}

function runGh(args: string[]): string | null {
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

export function fetchGithubData(
  owner: string | null,
  repo: string | null,
): GithubData {
  if (!owner || !repo) return { available: false, issues: [], labels: [] };

  const issuesRaw = runGh([
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
  ]);
  const labelsRaw = runGh([
    "label",
    "list",
    "--repo",
    `${owner}/${repo}`,
    "--json",
    "name",
    "--limit",
    "200",
  ]);

  if (issuesRaw === null || labelsRaw === null) {
    return { available: false, issues: [], labels: [] };
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

  const issues = (JSON.parse(issuesRaw) as RawIssue[]).map((i) => {
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

  const labels = (JSON.parse(labelsRaw) as RawLabel[]).map((l) => ({
    name: l.name,
    invariant: labelToInvariant(l.name),
  }));

  return { available: true, issues, labels };
}
