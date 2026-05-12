import { existsSync, readFileSync } from "node:fs";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface LoadFailure {
  ok: false;
  reason: string;
}

export interface LoadSuccess {
  ok: true;
  body: Record<string, unknown>;
}

export function loadSummaryFile(path: string): LoadSuccess | LoadFailure {
  if (!existsSync(path)) {
    return { ok: false, reason: ".evidence/SUMMARY.json not found" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `invalid JSON: ${msg}` };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "SUMMARY.json root must be an object" };
  }
  return { ok: true, body: parsed };
}
