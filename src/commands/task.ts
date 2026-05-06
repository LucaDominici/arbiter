import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

export type TaskPhase =
  | "preflight"
  | "plan"
  | "implementation"
  | "verification"
  | "complete";

const PHASE_ORDER: TaskPhase[] = [
  "preflight",
  "plan",
  "implementation",
  "verification",
  "complete",
];

export interface TaskAdvanceOptions {
  to: TaskPhase;
  dir?: string;
  reverse?: boolean;
}

function isValidPhase(s: string): s is TaskPhase {
  return (PHASE_ORDER as readonly string[]).includes(s);
}

function readPhase(claudeDir: string): TaskPhase {
  const p = join(claudeDir, ".task-phase");
  try {
    const raw = readFileSync(p, "utf-8").trim();
    if (!raw) return "preflight";
    if (!isValidPhase(raw)) {
      throw new Error(
        `Corrupted phase file at ${p}: unexpected value "${raw}". ` +
          `Valid phases: ${PHASE_ORDER.join(", ")}. ` +
          `Remove the file and re-run with --to preflight to reset.`,
      );
    }
    return raw;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "preflight";
    throw err;
  }
}

export function runTaskAdvance(opts: TaskAdvanceOptions): void {
  const dir = opts.dir ?? process.cwd();
  const claudeDir = join(dir, ".claude");
  const { to, reverse = false } = opts;

  if (!PHASE_ORDER.includes(to)) {
    throw new Error(
      `Invalid --to value: "${to}". Valid phases: ${PHASE_ORDER.join(", ")}`,
    );
  }

  const current = readPhase(claudeDir);
  const currentIdx = PHASE_ORDER.indexOf(current);
  const targetIdx = PHASE_ORDER.indexOf(to);

  if (currentIdx === targetIdx) return;

  if (targetIdx < currentIdx && !reverse) {
    throw new Error(
      `Backward transition "${current}" → "${to}" blocked. Use --reverse to allow backward transitions.`,
    );
  }

  if (targetIdx > currentIdx + 1) {
    throw new Error(
      `Illegal skip: cannot advance from "${current}" to "${to}" (missing intermediate phases). Advance one phase at a time.`,
    );
  }

  mkdirSync(claudeDir, { recursive: true });
  const timestamp = new Date().toISOString();
  writeFileSync(join(claudeDir, ".task-phase"), to + "\n");
  appendFileSync(
    join(claudeDir, ".task-phase-history"),
    `${timestamp} ${current} → ${to}\n`,
  );
}
