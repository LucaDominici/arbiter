import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/** Schema of a single JSONL entry written to .evidence/cmd-log.jsonl */
export interface EvidenceEntry {
  ts: string;
  cmd: string;
  args: string[];
  exit: number;
  durationMs: number;
  headSha: string;
}

const LOG_FILENAME = "cmd-log.jsonl";
const BACKUP_FILENAME = "cmd-log.jsonl.1";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface AppendEvidenceOptions {
  /** Root directory of the project (`.evidence/` is created inside it). Defaults to `process.cwd()`. */
  dir?: string;
  /** Byte threshold for rotation. Defaults to 10 MB. */
  maxBytes?: number;
  /** When true, skip logging entirely (--no-evidence). */
  noEvidence?: boolean;
}

/**
 * Append one JSONL line to `.evidence/cmd-log.jsonl`.
 *
 * - Creates `.evidence/` directory if absent.
 * - Rotates (renames to `.1`) when file size >= maxBytes.
 * - NEVER throws — evidence logging must not break CLI invocations.
 */
export function appendEvidenceLine(
  entry: EvidenceEntry,
  opts: AppendEvidenceOptions = {},
): void {
  if (opts.noEvidence) return;

  try {
    const root = opts.dir ?? process.cwd();
    const evidenceDir = join(root, ".evidence");
    const logPath = join(evidenceDir, LOG_FILENAME);
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

    mkdirSync(evidenceDir, { recursive: true });

    // Check size and rotate if needed
    let shouldRotate = false;
    try {
      const stat = statSync(logPath);
      if (stat.size >= maxBytes) shouldRotate = true;
    } catch {
      // File doesn't exist yet — no rotation needed
    }

    if (shouldRotate) {
      renameSync(logPath, join(evidenceDir, BACKUP_FILENAME));
    }

    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Swallow all errors — evidence logging is best-effort
  }
}
