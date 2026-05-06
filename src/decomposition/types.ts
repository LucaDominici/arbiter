export type WorkUnitStatus = "open" | "in_progress" | "blocked" | "done";

export type WorkUnitPhase =
  | "preflight"
  | "plan"
  | "implementation"
  | "verification"
  | "complete";

export interface WorkUnit {
  id: string;
  title: string;
  status: WorkUnitStatus;
  phase?: WorkUnitPhase;
  parent?: string;
  body?: string;
  labels?: string[];
}

export interface DecompositionBackend {
  readonly id: "github" | "markdown";
  list(filter?: { status?: WorkUnitStatus }): Promise<WorkUnit[]>;
  get(id: string): Promise<WorkUnit | null>;
  create(input: Omit<WorkUnit, "id">): Promise<WorkUnit>;
  advance(id: string, phase: WorkUnitPhase): Promise<void>;
  close(id: string, opts?: { reason?: string }): Promise<void>;
}
