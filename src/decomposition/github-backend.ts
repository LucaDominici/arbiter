import { runCli, runCliJson, CliError } from "../utils/run-cli.js";
import type { ArbiterConfigV2 } from "../config/schema.js";
import type {
  DecompositionBackend,
  WorkUnit,
  WorkUnitPhase,
  WorkUnitStatus,
} from "./types.js";

interface GhIssue {
  number: number;
  title: string;
  state: string;
  body?: string;
  labels: Array<{ name: string }>;
}

function ghStateToStatus(state: string): WorkUnitStatus {
  const s = state.toUpperCase();
  if (s === "CLOSED") return "done";
  return "open";
}

function statusToGhState(status: WorkUnitStatus): string {
  return status === "done" ? "closed" : "open";
}

function mapIssue(issue: GhIssue): WorkUnit {
  const unit: WorkUnit = {
    id: `#${issue.number}`,
    title: issue.title,
    status: ghStateToStatus(issue.state),
    labels: issue.labels.map((l) => l.name),
  };
  if (issue.body) unit.body = issue.body;
  return unit;
}

function stripHash(id: string): string {
  return id.startsWith("#") ? id.slice(1) : id;
}

export class GitHubBackend implements DecompositionBackend {
  readonly id = "github" as const;

  private readonly _owner: string | null;
  private readonly _repo: string | null;

  constructor(config: ArbiterConfigV2) {
    this._owner = config.decomposition?.github?.owner ?? null;
    this._repo = config.decomposition?.github?.repo ?? null;
  }

  private repoCoords(): { owner: string; repo: string } {
    if (!this._owner || !this._repo) {
      const result = runCliJson(
        "gh",
        ["repo", "view", "--json", "nameWithOwner"],
        {},
      ) as { nameWithOwner: string };
      const parts = result.nameWithOwner.split("/");
      const owner = parts[0] ?? "";
      const repo = parts[1] ?? "";
      return { owner, repo };
    }
    return { owner: this._owner, repo: this._repo };
  }

  private repoFlag(): string {
    const { owner, repo } = this.repoCoords();
    return `${owner}/${repo}`;
  }

  list(filter?: { status?: WorkUnitStatus }): Promise<WorkUnit[]> {
    const args = [
      "issue",
      "list",
      "-R",
      this.repoFlag(),
      "--json",
      "number,title,state,body,labels",
      "--limit",
      "200",
    ];

    if (filter?.status) {
      args.push("--state", statusToGhState(filter.status));
    }

    const issues = runCliJson("gh", args, {}) as GhIssue[];
    return Promise.resolve(issues.map(mapIssue));
  }

  get(id: string): Promise<WorkUnit | null> {
    const num = stripHash(id);
    try {
      const issue = runCliJson(
        "gh",
        [
          "issue",
          "view",
          num,
          "-R",
          this.repoFlag(),
          "--json",
          "number,title,state,body,labels",
        ],
        {},
      ) as GhIssue;
      return Promise.resolve(mapIssue(issue));
    } catch (err) {
      if (err instanceof CliError) return Promise.resolve(null);
      return Promise.reject(err as Error);
    }
  }

  create(input: Omit<WorkUnit, "id">): Promise<WorkUnit> {
    const args = [
      "issue",
      "create",
      "-R",
      this.repoFlag(),
      "--title",
      input.title,
    ];

    if (input.body) args.push("--body", input.body);
    if (input.labels && input.labels.length > 0) {
      args.push("--label", input.labels.join(","));
    }

    const result = runCliJson("gh", args, {}) as { number: number };
    const unit: WorkUnit = {
      id: `#${result.number}`,
      title: input.title,
      status: input.status,
    };
    if (input.phase) unit.phase = input.phase;
    if (input.parent) unit.parent = input.parent;
    if (input.body) unit.body = input.body;
    if (input.labels) unit.labels = input.labels;
    return Promise.resolve(unit);
  }

  async advance(id: string, phase: WorkUnitPhase): Promise<void> {
    const num = stripHash(id);
    const phaseLabel = `phase/${phase}`;

    const existing = await this.get(id);
    if (!existing) throw new Error(`Work unit "${id}" not found`);

    const oldPhaseLabels = (existing.labels ?? []).filter((l) =>
      l.startsWith("phase/"),
    );

    const editArgs = [
      "issue",
      "edit",
      num,
      "-R",
      this.repoFlag(),
      "--add-label",
      phaseLabel,
    ];

    if (oldPhaseLabels.length > 0) {
      editArgs.push("--remove-label", oldPhaseLabels.join(","));
    }

    runCli("gh", editArgs, {});
  }

  close(id: string, opts?: { reason?: string }): Promise<void> {
    const num = stripHash(id);
    const args = ["issue", "close", num, "-R", this.repoFlag()];

    if (opts?.reason) {
      args.push("--comment", `Closed: ${opts.reason}`);
    }

    runCli("gh", args, {});
    return Promise.resolve();
  }
}
