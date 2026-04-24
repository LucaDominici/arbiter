import type { SemVer } from "./parsers.js";

/** One tool probe entry within the matrix */
export interface MatrixEntry {
  /** CLI tool name (e.g. "node", "java") */
  tool: string;
  /** Version range expression (e.g. ">=18 <22") */
  range: string;
}

/** Per-language set of required tools */
export interface LanguageMatrix {
  typescript: MatrixEntry[];
  java: MatrixEntry[];
  kotlin: MatrixEntry[];
  rust: MatrixEntry[];
  go: MatrixEntry[];
  python: MatrixEntry[];
}

/** Result of probing a single tool */
export type ProbeStatus = "passed" | "skipped" | "failed";

/** Whether probe checks installed tool version or invokes a build command */
export type ProbeKind = "version" | "build";

export interface ProbeResult {
  tool: string;
  status: ProbeStatus;
  /** Distinguishes version checks from build-invocation probes */
  kind?: ProbeKind;
  /** Parsed version if the tool was found */
  version?: SemVer;
  /** Human-readable reason for skipped or failed */
  reason?: string;
}

/** Aggregated report for all probed tools */
export interface VerifyReport {
  /** Target directory that was probed */
  dir: string;
  /** Detected language stack */
  stack: string;
  /** Results for each probed tool */
  probes: ProbeResult[];
  /** true if any probe has status "failed" */
  hasFailures: boolean;
}
