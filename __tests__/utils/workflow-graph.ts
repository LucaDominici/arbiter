// SPDX-License-Identifier: Apache-2.0
//
// Test-support helper for the static workflow critical-path estimator (#1232).
//
// CANON-16 Existing Code Survey: grepped src/ and scripts/ for `needs:` /
// `longest` / DAG parsing. Found `scripts/check-workflow-parallelism.mjs`
// (`parseWorkflowJobs` + `longestChain`) — an UNWEIGHTED edge-count gate that
// excludes `if: always()` sinks. Rejected reuse: that gate measures structural
// chain DEPTH (number of edges); this helper measures WALL-CLOCK time (weighted
// longest path from per-step duration estimates) and additionally extracts each
// job's steps for time lookup. Different axis, different output, and it lives
// under `__tests__/` as a typed test util rather than a `.mjs` gate. New file
// justified. The critical-path parser below stays line-oriented (it only needs
// the job DAG + per-step identifiers, and a tolerant scanner is robust to the
// `${{ }}` expression soup in step bodies).
//
// #1549: the reusable-workflow contract helpers at the bottom of this file DO
// fully parse rendered YAML via `js-yaml` (a declared devDependency, ^5.2.1).
// Resolving a caller's `with:` block against a callee's `on.workflow_call.inputs`
// needs real structural parsing — the line scanner cannot reliably associate a
// `with:` key with the enclosing job's `uses:`. This is the static guard that
// would have caught the #1548 `_notify` contract break.
//
// js-yaml v5 ships pure ESM with only named exports (no default export) — a
// default import resolves to `undefined`. Import `load` by name (#1758).

import { load } from 'js-yaml'

/** A single workflow job parsed from rendered YAML. */
export interface WorkflowJob {
  /** Job IDs this job declares in `needs:`. */
  readonly needs: string[]
  /** True when the job is an `if: always()` aggregator sink. */
  readonly alwaysIf: boolean
  /**
   * Normalized step identifiers used for time lookup.
   * For `uses:` steps → the action name without the `@<ref>` pin
   * (e.g. `actions/checkout`). For `run:` steps → the first command line
   * (e.g. `mvn test -Punit`). Pure barriers (no uses/run) are omitted.
   */
  readonly steps: string[]
}

/** Lookup table: step identifier → estimated minutes. `_default` is the fallback. */
export interface StepEstimates {
  readonly [step: string]: number
  readonly _default: number
}

/** One node on a resolved critical path. */
export interface CriticalPathNode {
  readonly job: string
  readonly minutes: number
}

/** Result of the weighted longest-path computation. */
export interface CriticalPath {
  /** Total weighted minutes along the longest path. */
  readonly minutes: number
  /** Ordered nodes from root to deepest sink, each with its own job weight. */
  readonly path: CriticalPathNode[]
}

/** Raised when the job graph contains a `needs:` cycle. */
export class WorkflowGraphCycleError extends Error {
  constructor(public readonly cycleJob: string) {
    super(`workflow-graph: cycle detected in job needs-graph at "${cycleJob}"`)
    this.name = 'WorkflowGraphCycleError'
  }
}

/**
 * Strip the `@<ref>` pin and trailing `# comment` from a `uses:` value,
 * yielding the bare action name (e.g. `actions/checkout@<sha>  # v6` →
 * `actions/checkout`).
 */
function normalizeUses(value: string): string {
  const noComment = value.split('#')[0].trim()
  const atIdx = noComment.indexOf('@')
  return atIdx === -1 ? noComment : noComment.slice(0, atIdx)
}

/**
 * Parse rendered workflow YAML into a job DAG with per-job steps.
 *
 * Line-oriented scanner (no YAML library). Handles:
 *  - block + compact (`job: { ... }`) job mappings
 *  - inline (`needs: [a, b]`), single (`needs: a`), and multi-line `needs:` lists
 *  - `if: always()` sink detection (inline and block)
 *  - `uses:` and `run:` step extraction (incl. `run: |` multi-line blocks,
 *    where only the first command line is captured for lookup)
 */
export function parseWorkflowJobs(content: string): Map<string, WorkflowJob> {
  const jobs = new Map<string, WorkflowJob>()
  const lines = content.split('\n')

  let inJobs = false
  let currentJob: string | null = null
  let needs: string[] = []
  let alwaysIf = false
  let steps: string[] = []
  let inNeedsBlock = false
  // When > 0, we are inside a `run: |` / `run: >` literal block and must
  // capture only its first content line, then ignore the rest until dedent.
  let runBlockIndent = -1

  const flush = (): void => {
    if (currentJob !== null) {
      jobs.set(currentJob, { needs, alwaysIf, steps })
    }
  }

  for (const line of lines) {
    const stripped = line.trimStart()
    const indent = line.length - stripped.length

    if (/^jobs\s*:/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue

    // Non-empty, non-comment column-0 line ends the jobs block.
    if (indent === 0 && stripped.length > 0 && !stripped.startsWith('#')) break

    // Inside a `run: |` block: capture first content line, swallow the rest.
    if (runBlockIndent >= 0) {
      if (stripped.length === 0) continue
      if (indent > runBlockIndent) {
        // First body line of the block — record it as the step command.
        steps.push(stripped.trim())
        runBlockIndent = -2 // sentinel: body captured, keep swallowing
        continue
      }
      if (runBlockIndent === -2 && indent > 0 && stripped.length > 0) {
        // Could be a deeper continuation; only break out on a real dedent.
        // Re-evaluate this line below by falling through after clearing state
        // when indentation returns to step/job level.
      }
      // Dedent back to step or job level → block finished, fall through.
      runBlockIndent = -1
    }

    // Job-level key: exactly 2-space indent.
    const jobMatch = /^ {2}([a-zA-Z][a-zA-Z0-9_-]*):/.exec(line)
    if (jobMatch) {
      flush()
      currentJob = jobMatch[1]
      needs = []
      alwaysIf = false
      steps = []
      inNeedsBlock = false
      runBlockIndent = -1

      if (/if:\s+always\(\)/.test(line)) alwaysIf = true
      const compactNeeds = /needs:\s*\[([^\]]*)\]/.exec(line)
      if (compactNeeds) {
        needs = compactNeeds[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
      continue
    }

    if (currentJob === null) continue

    if (/^\s+if:\s+always\(\)/.test(line)) alwaysIf = true

    const inlineNeeds = /^\s+needs:\s*\[([^\]]*)\]/.exec(line)
    if (inlineNeeds) {
      inNeedsBlock = false
      needs = inlineNeeds[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      continue
    }

    const singleNeeds = /^\s+needs:\s+([a-zA-Z][a-zA-Z0-9_-]*)\s*$/.exec(line)
    if (singleNeeds) {
      inNeedsBlock = false
      needs = [singleNeeds[1]]
      continue
    }

    if (/^\s+needs:\s*$/.test(line)) {
      inNeedsBlock = true
      needs = []
      continue
    }

    if (inNeedsBlock) {
      const listItem = /^\s+-\s+([a-zA-Z][a-zA-Z0-9_-]*)/.exec(line)
      if (listItem) {
        needs.push(listItem[1])
        continue
      }
      if (stripped.length > 0 && !stripped.startsWith('-')) {
        inNeedsBlock = false
      }
    }

    // Step: `- uses: <action>` or `uses: <action>` (as a step property).
    const usesMatch = /^\s*-?\s*uses:\s+(\S.*)$/.exec(line)
    if (usesMatch) {
      steps.push(normalizeUses(usesMatch[1]))
      continue
    }

    // Step: inline `- run: <cmd>` (single line).
    const runInline = /^\s*-?\s*run:\s+(\S.*)$/.exec(line)
    if (runInline) {
      const cmd = runInline[1].trim()
      if (cmd === '|' || cmd === '>' || cmd === '|-' || cmd === '>-') {
        runBlockIndent = indent
      } else {
        steps.push(cmd)
      }
      continue
    }
  }

  flush()
  return jobs
}

/**
 * Estimate a job's wall-clock minutes by summing per-step estimates.
 * A step matches an estimate key when the step identifier contains that key
 * as a substring (so `mvn test -Punit` matches the `mvn test` key, and
 * `actions/checkout` matches the `actions/checkout` key). The longest matching
 * key wins; unmatched steps fall back to `_default`.
 */
export function estimateJobMinutes(steps: readonly string[], estimates: StepEstimates): number {
  const keys = Object.keys(estimates)
    .filter((k) => k !== '_default')
    .sort((a, b) => b.length - a.length)
  let total = 0
  for (const step of steps) {
    const match = keys.find((k) => step.includes(k))
    total += match !== undefined ? estimates[match] : estimates._default
  }
  return total
}

/**
 * Compute the longest weighted path through the job DAG.
 *
 * `weightOf(job)` returns the wall-clock minutes for a single job; the path
 * cost is the sum of weights of the jobs along it. `if: always()` aggregator
 * sinks are excluded (pure status barriers, not wall-clock contributors),
 * mirroring `check-workflow-parallelism.mjs`.
 *
 * Throws {@link WorkflowGraphCycleError} on a cyclic `needs:` graph rather than
 * recursing forever.
 */
export function longestWeightedPath(
  jobs: Map<string, WorkflowJob>,
  weightOf: (job: WorkflowJob) => number,
): CriticalPath {
  const filtered = new Map([...jobs.entries()].filter(([, v]) => !v.alwaysIf))
  if (filtered.size === 0) return { minutes: 0, path: [] }

  const memo = new Map<string, CriticalPath>()
  // Three-color cycle detection: WHITE = unvisited, GRAY = on stack, BLACK = done.
  const color = new Map<string, 'gray' | 'black'>()

  const longestEndingAt = (jobName: string): CriticalPath => {
    const cached = memo.get(jobName)
    if (cached) return cached
    if (color.get(jobName) === 'gray') throw new WorkflowGraphCycleError(jobName)
    color.set(jobName, 'gray')

    const data = filtered.get(jobName)
    const selfWeight = data ? weightOf(data) : 0
    const selfNode: CriticalPathNode = { job: jobName, minutes: selfWeight }

    let best: CriticalPath = { minutes: selfWeight, path: [selfNode] }
    if (data) {
      for (const parent of data.needs) {
        if (!filtered.has(parent)) continue
        const parentPath = longestEndingAt(parent)
        const candidateMinutes = parentPath.minutes + selfWeight
        if (candidateMinutes > best.minutes) {
          best = { minutes: candidateMinutes, path: [...parentPath.path, selfNode] }
        }
      }
    }

    color.set(jobName, 'black')
    memo.set(jobName, best)
    return best
  }

  let globalBest: CriticalPath = { minutes: 0, path: [] }
  for (const jobName of filtered.keys()) {
    const path = longestEndingAt(jobName)
    if (path.minutes > globalBest.minutes) globalBest = path
  }
  return globalBest
}

/** Format a critical path like `gate(3.7m) → unit-tests(10m) = 13.7m (budget 15m)`. */
export function formatCriticalPath(cp: CriticalPath, budgetMinutes: number): string {
  const chain = cp.path.map((n) => `${n.job}(${round(n.minutes)}m)`).join(' → ')
  return `${chain} = ${round(cp.minutes)}m (budget ${budgetMinutes}m)`
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

// ─── Reusable-workflow contract resolution (#1548, #1549) ────────────────────

/**
 * Parse a rendered workflow's `jobs` into a map of job-id → declared `needs:`
 * (normalized to a string array; a scalar `needs: x` becomes `['x']`). Uses
 * `js-yaml` so the result reflects the structure GitHub actually sees. Returns
 * an empty map when the document has no `jobs`.
 */
export function parseJobNeeds(content: string): Map<string, string[]> {
  const doc = load(content) as Record<string, unknown> | null
  const jobs = doc && typeof doc === 'object' ? (doc as { jobs?: unknown }).jobs : undefined
  const map = new Map<string, string[]>()
  if (!jobs || typeof jobs !== 'object') return map
  for (const [job, body] of Object.entries(jobs as Record<string, unknown>)) {
    const needs = body && typeof body === 'object' ? (body as { needs?: unknown }).needs : undefined
    if (typeof needs === 'string') map.set(job, [needs])
    else if (Array.isArray(needs)) map.set(job, needs.map(String))
    else map.set(job, [])
  }
  return map
}

/** A single declared input on a reusable workflow's `on.workflow_call`. */
export interface ReusableInputSpec {
  /** True when the input is declared `required: true` (no default fallback). */
  readonly required: boolean
}

/**
 * Parse a rendered workflow's `on.workflow_call.inputs` into a map of
 * input-name → spec. Returns `null` when the workflow declares no
 * `workflow_call` trigger (i.e. it is not a reusable/callable workflow).
 */
export function parseWorkflowCallInputs(content: string): Map<string, ReusableInputSpec> | null {
  const doc = load(content) as Record<string, unknown> | null
  if (!doc || typeof doc !== 'object') return null
  const on = (doc as { on?: unknown }).on
  if (!on || typeof on !== 'object') return null
  const wc = (on as { workflow_call?: unknown }).workflow_call
  if (wc === undefined) return null
  const inputs = wc && typeof wc === 'object' ? (wc as { inputs?: unknown }).inputs : undefined
  const map = new Map<string, ReusableInputSpec>()
  if (inputs && typeof inputs === 'object') {
    for (const [name, spec] of Object.entries(inputs as Record<string, unknown>)) {
      const required =
        !!spec && typeof spec === 'object' && (spec as { required?: unknown }).required === true
      map.set(name, { required })
    }
  }
  return map
}

/** A reusable-workflow invocation found in a caller workflow's jobs. */
export interface ReusableCall {
  /** Calling job id. */
  readonly job: string
  /** Callee workflow file name, e.g. `_notify.yml`. */
  readonly callee: string
  /** Keys supplied in the call's `with:` block (empty when none). */
  readonly withKeys: string[]
}

/**
 * Extract every job whose body is a *local* reusable-workflow call
 * (`uses: ./.github/workflows/<file>`), together with the keys it passes via
 * `with:`. Remote `uses:` (org/repo@ref) calls are ignored — their contract is
 * not resolvable from this repo.
 */
export function parseReusableCalls(content: string): ReusableCall[] {
  const doc = load(content) as Record<string, unknown> | null
  const jobs = doc && typeof doc === 'object' ? (doc as { jobs?: unknown }).jobs : undefined
  if (!jobs || typeof jobs !== 'object') return []
  const calls: ReusableCall[] = []
  for (const [job, body] of Object.entries(jobs as Record<string, unknown>)) {
    if (!body || typeof body !== 'object') continue
    const uses = (body as { uses?: unknown }).uses
    if (typeof uses !== 'string') continue
    const match = /^\.\/\.github\/workflows\/(\S+)$/.exec(uses.trim())
    if (!match) continue
    const withBlock = (body as { with?: unknown }).with
    const withKeys =
      withBlock && typeof withBlock === 'object' ? Object.keys(withBlock as object) : []
    calls.push({ job, callee: match[1], withKeys })
  }
  return calls
}

/** A resolved violation of a reusable-workflow input contract. */
export interface ReusableContractViolation {
  readonly job: string
  readonly callee: string
  readonly kind: 'undeclared-input' | 'missing-required-input'
  readonly input: string
}

/**
 * Resolve one caller's reusable calls against the callee input contracts.
 * Flags (a) every `with:` key the callee does not declare, and (b) every
 * `required: true` callee input the caller fails to supply. `contracts` maps a
 * callee file name (`_notify.yml`) to its parsed inputs. A call to a callee
 * absent from `contracts` is skipped (caller-side test cannot resolve it).
 */
export function resolveReusableContract(
  calls: readonly ReusableCall[],
  contracts: Map<string, Map<string, ReusableInputSpec>>,
): ReusableContractViolation[] {
  const violations: ReusableContractViolation[] = []
  for (const call of calls) {
    const inputs = contracts.get(call.callee)
    if (!inputs) continue
    for (const key of call.withKeys) {
      if (!inputs.has(key)) {
        violations.push({
          job: call.job,
          callee: call.callee,
          kind: 'undeclared-input',
          input: key,
        })
      }
    }
    for (const [name, spec] of inputs) {
      if (spec.required && !call.withKeys.includes(name)) {
        violations.push({
          job: call.job,
          callee: call.callee,
          kind: 'missing-required-input',
          input: name,
        })
      }
    }
  }
  return violations
}
