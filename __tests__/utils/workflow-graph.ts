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
// justified. Parser shape is intentionally modelled on the prior-art
// line-oriented scanner (no `yaml`/`js-yaml` import — neither is a declared
// dependency, importing one would trip the knip/dependency gates).

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
