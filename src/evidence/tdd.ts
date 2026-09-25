// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve, win32 } from 'node:path'
import { z } from 'zod'
import { writeFile, assertWritten } from '../utils/fs.js'

function safeRepoRelativeDirectory(path: string): boolean {
  return (
    path === '.' ||
    (!isAbsolute(path) &&
      !win32.isAbsolute(path) &&
      path.split(/[\\/]/).every((segment) => segment !== '..' && segment !== ''))
  )
}

export const TddEvidenceV1 = z.object({
  $schemaVersion: z.literal(1),
  task_id: z.string().regex(/^#\d+$/, 'task_id must start with # followed by digits'),
  test_path: z.string().min(1),
  test_cwd: z
    .string()
    .min(1)
    .refine(safeRepoRelativeDirectory, 'test_cwd must be a repository-relative directory')
    .optional(),
  test_commit_sha: z.string().length(40, 'test_commit_sha must be exactly 40 hex characters'),
  // #2116: rebase-stable pin. A rebase rewrites test_commit_sha out of the branch but
  // never the test's content, so the blob sha lets the RED commit be re-resolved.
  // Optional — evidence recorded before #2116 carries no blob and cannot be healed.
  test_blob_sha: z
    .string()
    .length(40, 'test_blob_sha must be exactly 40 hex characters')
    .optional(),
  test_run_log: z.string(),
  observed_failure: z.string().min(1, 'observed_failure must not be empty'),
  recorded_at: z.iso.datetime({ message: 'recorded_at must be ISO8601' }),
  test_command: z.array(z.string()).optional(),
})
export type TddEvidence = z.infer<typeof TddEvidenceV1>

export interface FailureSignatureEntry {
  framework: string
  pattern: RegExp
}

export const FAILURE_SIGNATURES: FailureSignatureEntry[] = [
  // Vitest's `test.projects` (#2516) prefixes the path with a `|<project name>|` label
  // (e.g. `FAIL  |unit| foo.test.ts`) — the optional group tolerates that without
  // widening the match to swallow an unrelated leading token. Anchored to line start
  // and restricted to horizontal whitespace ([ \t], not \s) so a label cannot swallow
  // a newline and mint a match against an unrelated line below it (e.g.
  // `FAIL |unit|\nnot-a-real-failure.test.ts`). The label body itself allows any
  // non-pipe, non-newline character so a project name containing spaces still matches.
  {
    framework: 'vitest',
    pattern: /(?<=^[ \t]*)FAIL[ \t]+(?:\|[^|\n]+\|[ \t]+)?\S+\.test\.[jt]sx?/m,
  },
  {
    framework: 'jest',
    pattern: /(?<=^[ \t]*)FAIL[ \t]+(?:\|[^|\n]+\|[ \t]+)?\S+\.(spec|test)\.[jt]sx?/m,
  },
  { framework: 'cucumber', pattern: /\d+ scenarios? \(\d+ failed/m },
  { framework: 'pytest', pattern: /={3,}\s*FAILURES\s*={3,}/m },
  { framework: 'gradle', pattern: /FAILED\s*$|BUILD FAILED/m },
  { framework: 'cargo', pattern: /test result: FAILED/m },
  { framework: 'go', pattern: /--- FAIL:/m },
  { framework: 'shell', pattern: /^[ \t]*FAIL:[ \t]+\S.*$/m },
  { framework: 'tap', pattern: /^# fail [1-9]\d*/m },
  { framework: 'playwright', pattern: /^\s*[1-9]\d* failed\b/m },
]

export interface ExtractResult {
  framework: string
  match: string
}

// Strip ANSI SGR colour codes before matching. Test runners (vitest, jest, ...)
// force colour on even when stdout is piped once `CI` is set in the environment —
// an escape sequence landing between "FAIL" and the test path (e.g.
// `FAIL \x1b[22m\x1b[49m src/foo.test.ts`) breaks the plain-text signatures below,
// so `record-red` reports a false "test appears to pass" under CI (nightly
// generated-gate-e2e, #1770-class regression).
// eslint-disable-next-line no-control-regex -- strips ANSI SGR codes (\x1b[...m)
const ANSI_SGR = /\x1b\[[0-9;]*m/g
// Vitest can wrap a multiword project badge in SGR codes. Normalize only that
// complete, same-line badge-plus-JS-path shape before stripping the styling;
// SGR delimiters may surround FAIL and appear between the badge delimiters.
// Match Vitest's actual `black(background(project))` framing, including paired
// resets. A background alone is ordinary terminal styling, not reporter proof.
const ANSI_WRAPPED_JS_BADGE =
  /(^[ \t]*(?:\x1b\[[0-9;]*m[ \t]*)*FAIL[ \t]+(?:\x1b\[[0-9;]*m[ \t]*)*)\x1b\[30m\x1b\[4[1-7]m[ \t]+([^|\n]+?)[ \t]+\x1b\[49m\x1b\[39m[ \t]+(\S+\.(?:spec|test)\.[jt]sx?\b)/gm // eslint-disable-line no-control-regex -- matches ANSI SGR delimiters

export function extractFailureSignature(log: string): ExtractResult | null {
  const plain = log.replace(ANSI_SGR, '')
  for (const entry of FAILURE_SIGNATURES) {
    const m = plain.match(entry.pattern)
    if (m !== null) {
      return { framework: entry.framework, match: m[0] }
    }
  }
  return null
}

/**
 * V1 already retains the complete log: derive identity instead of persisting a
 * second list. Keep every JS FAIL header, including Vitest test labels, across
 * mixed .test/.spec files. Other runners retain their legacy summary granularity.
 * Ordering and colour are incidental; whitespace inside test names is identity.
 */
export function extractFailureIdentities(log: string): string[] {
  const plain = log.replace(ANSI_WRAPPED_JS_BADGE, '$1|$2| $3').replace(ANSI_SGR, '')
  const jsIdentities: string[] = []
  // Diagnostics can quote "FAIL path.test.ts" in a code frame. Only actual
  // header lines prove a JS failure; legacy scalar extraction stays unchanged.
  const jsHeader = /^ ?FAIL[ \t]+(?:\|[^|\n]+\|[ \t]+)?\S+\.(?:spec|test)\.[jt]sx?\b/gm
  for (const match of plain.matchAll(jsHeader)) {
    let identity = match[0].trim().replace(/^FAIL\s+/, 'FAIL ')
    const suffix = plain.slice(match.index + match[0].length).split(/\r?\n/, 1)[0] ?? ''
    if (/^[ \t]+>/.test(suffix)) identity += ` ${suffix.trim()}`
    jsIdentities.push(identity)
  }

  const legacyIdentities = new Set<string>()
  for (const { framework, pattern } of FAILURE_SIGNATURES) {
    if (framework === 'vitest' || framework === 'jest') continue
    for (const match of plain.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      legacyIdentities.add(match[0].trim())
    }
  }
  return [...jsIdentities, ...legacyIdentities].sort()
}

/** Recording and isolated replay must name the same repository-relative paths. */
export function repositoryRelativeLog(log: string, dir: string): string {
  const root = resolve(dir)
  const roots = [root, root.replaceAll('\\', '/')]
  return roots.reduce(
    (relative, prefix) =>
      relative.replaceAll(`${prefix}/`, '').replaceAll(`${prefix}\\`, '').replaceAll(prefix, '.'),
    log,
  )
}

/** Keep recording and replay stdout/stderr framing identical. */
export function combineTestOutput(stdout: string, stderr: string): string {
  return stdout + (stderr ? `\n${stderr}` : '')
}

export function tddEvidencePath(taskId: string, repoDir: string): string {
  return join(repoDir, '.arbiter', 'evidence', 'tdd', `${taskId}.json`)
}

export interface LoadSuccess {
  ok: true
  data: TddEvidence
}

export interface LoadFailure {
  ok: false
  reason: string
}

export function loadTddEvidence(taskId: string, repoDir: string): LoadSuccess | LoadFailure {
  const p = tddEvidencePath(taskId, repoDir)
  if (!existsSync(p)) {
    return { ok: false, reason: `TDD evidence not found at ${p}` }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'))
  } catch (err) {
    return {
      ok: false,
      reason: `invalid JSON in evidence file: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const parsed = TddEvidenceV1.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `schema validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    }
  }
  return { ok: true, data: parsed.data }
}

export interface WriteTddEvidenceOptions {
  repoDir: string
  evidence: TddEvidence
}

/**
 * #2064: never clobber another task's evidence. `task_id` selects the destination
 * path, so a mismatch can only happen when the on-disk file's OWN `task_id` field
 * disagrees with its filename — a corrupted/hand-edited file. Refuse rather than
 * guess. Schema-validates before writing (fail before touching disk) and writes
 * atomically (temp-file + rename, via the shared `writeFile` — same primitive
 * `task-state.ts` uses for its status document) so a crash mid-write leaves prior
 * evidence untouched.
 *
 * #2533: TDD evidence is internal tooling state, never a generator-emitted target a
 * downstream repo would hand-customise — so it is written with `skipPreserveCheck`,
 * exempting it from `writeFile`'s `arbiter:preserve` marker (a captured
 * `test_run_log` legitimately quoting that literal, e.g. from AGENTS.md, must not
 * freeze the file). The returned `WriteResult` is then asserted via `assertWritten`
 * so a write that still did not land — for whatever reason — is a loud failure
 * (`record-red` surfaces it as FAIL), never a silently-skipped `OK`.
 */
export function writeTddEvidence({ repoDir, evidence }: WriteTddEvidenceOptions): string {
  const parsed = TddEvidenceV1.parse(evidence)
  const p = tddEvidencePath(parsed.task_id, repoDir)
  if (existsSync(p)) {
    const existing = loadTddEvidence(parsed.task_id, repoDir)
    if (existing.ok && existing.data.task_id !== parsed.task_id) {
      throw new Error(
        `refusing to overwrite ${p}: it belongs to task ${existing.data.task_id}, not ${parsed.task_id}`,
      )
    }
  }
  const result = writeFile(p, JSON.stringify(parsed, null, 2) + '\n', { skipPreserveCheck: true })
  assertWritten(result, `TDD evidence for ${parsed.task_id}`)
  return p
}
