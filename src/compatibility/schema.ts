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

/** Fields shared by every probe outcome regardless of `status`. */
interface ProbeResultBase {
  tool: string
  /** Distinguishes version checks from build-invocation probes */
  kind?: ProbeKind
}

/**
 * Result of probing a single tool, discriminated on `status` (#1533 item 3).
 * Modelling the four outcomes as a union — rather than a flat record with three
 * independent optionals — makes the real invariants compile-time facts: a
 * `failed`/`skipped`/`warning` probe ALWAYS carries a `reason`, and only the
 * version-bearing states expose `version`. Consumers no longer defensively
 * null-check fields the type can prove present (or absent).
 */
export type ProbeResult =
  | (ProbeResultBase & {
      status: 'passed'
      /** Parsed version when this was a version probe that found the tool. */
      version?: SemVer
      /** Optional advisory trail (e.g. build stderr warnings on a zero exit). */
      reason?: string
    })
  | (ProbeResultBase & {
      status: 'failed'
      /** Present when a version probe found-but-rejected the tool. */
      version?: SemVer
      /** Human-readable failure cause — always present for a failure. */
      reason: string
    })
  | (ProbeResultBase & {
      status: 'skipped'
      /** Why the probe was skipped (e.g. toolchain-missing). */
      reason: string
    })
  | (ProbeResultBase & {
      status: 'warning'
      /** Human-readable warning detail — always present for a warning. */
      reason: string
    })

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
