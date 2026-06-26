// SPDX-License-Identifier: Apache-2.0
import type { SemVer } from './parsers.js'

/** One tool probe entry within the matrix */
export interface MatrixEntry {
  /** CLI tool name (e.g. "node", "java") */
  tool: string
  /** Version range expression (e.g. ">=18 <22") */
  range: string
}

/** Per-language set of required tools */
export interface LanguageMatrix {
  typescript: MatrixEntry[]
  java: MatrixEntry[]
  kotlin: MatrixEntry[]
  rust: MatrixEntry[]
  go: MatrixEntry[]
  python: MatrixEntry[]
}

/** Result of probing a single tool */
export type ProbeStatus = 'passed' | 'skipped' | 'failed' | 'warning'

/** Whether probe checks installed tool version or invokes a build command */
type ProbeKind = 'version' | 'build'

export interface ProbeResult {
  tool: string
  status: ProbeStatus
  /** Distinguishes version checks from build-invocation probes */
  kind?: ProbeKind
  /** Parsed version if the tool was found */
  version?: SemVer
  /** Human-readable reason for skipped or failed */
  reason?: string
}

/**
 * Aggregated report for all probed tools. `hasFailures`/`hasWarnings` are DERIVED from `probes`
 * and `probes` is readonly, so the invariant cannot drift — always build one via
 * {@link makeVerifyReport}, never by hand-setting the two booleans alongside a mutable array.
 */
export interface VerifyReport {
  /** Target directory that was probed */
  readonly dir: string
  /** Detected language stack */
  readonly stack: string
  /** Results for each probed tool */
  readonly probes: readonly ProbeResult[]
  /** true if any probe has status "failed" (derived from `probes`) */
  readonly hasFailures: boolean
  /** true if any probe has status "warning" (derived from `probes`) */
  readonly hasWarnings: boolean
}

/**
 * Construct a {@link VerifyReport}, deriving `hasFailures`/`hasWarnings` from `probes` in the one
 * place they are computed. This is the only sanctioned constructor — it keeps the two summary
 * booleans in lock-step with the probe array so no producer can leave them out of sync (#1533).
 */
export function makeVerifyReport(
  dir: string,
  stack: string,
  probes: readonly ProbeResult[],
): VerifyReport {
  return {
    dir,
    stack,
    probes,
    hasFailures: probes.some((p) => p.status === 'failed'),
    hasWarnings: probes.some((p) => p.status === 'warning'),
  }
}
