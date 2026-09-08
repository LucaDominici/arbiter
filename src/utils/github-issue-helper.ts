// SPDX-License-Identifier: Apache-2.0
//
// Shared GitHub-issue helper (CANON-16 extraction from `commands/task-record-tech-debt.ts`).
//
// Both `arbiter task record-tech-debt` and `arbiter findings promote` file GitHub issues and
// persist the resulting issue number under `.arbiter/evidence/<task>/tech-debt.json` (which
// `scripts/gen-gap.mjs` reads to populate GAP.md). Extracting the two private helpers into one
// shared module gives both callers ONE `gh issue create` code path — no duplicated invocation
// (the duplication ratchet would otherwise flag a second copy).
//
// `createGhIssue` takes a CALLER-SUPPLIED `labels[]` (not hardcoded): `record-tech-debt` passes
// `['tech-debt','follow-up']`; `findings promote` passes `['finding','tech-debt', priority/Pn]`.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile, readFileTranslated, assertWritten } from './fs.js'
import { runCli, CliError } from './run-cli.js'

export interface CreateGhIssueInput {
  /** Issue title. */
  title: string
  /** Issue body (Markdown). */
  body: string
  /** Labels to apply — each becomes its own `--label` flag. Caller-owned, never hardcoded. */
  labels: readonly string[]
}

export type CreateGhIssueResult = { ok: true; issueNumber: number } | { ok: false; reason: string }

/** Parse `https://github.com/owner/repo/issues/42` → 42 (searches all stdout lines). */
function parseIssueNumber(stdout: string): number | null {
  const urlLine = stdout.split('\n').find((l) => /\/issues\/\d+$/.test(l.trim()))
  const issueStr = urlLine?.trim().match(/\/issues\/(\d+)$/)?.[1]
  return issueStr !== undefined ? Number.parseInt(issueStr, 10) : null
}

/**
 * Create a GitHub issue via `gh issue create` with caller-supplied title/body/labels.
 * Soft-fails (returns `{ ok:false }`) on a missing `gh`, timeout, non-zero exit, or an
 * unparseable issue number — never throws for those cases. All invocation goes through the
 * INV-12 `runCli` spawn util (no direct `child_process`).
 */
export function createGhIssue(dir: string, input: CreateGhIssueInput): CreateGhIssueResult {
  const labelArgs = input.labels.flatMap((label) => ['--label', label])
  let stdout: string
  try {
    const result = runCli(
      'gh',
      ['issue', 'create', '--title', input.title, '--body', input.body, ...labelArgs],
      { cwd: dir, timeoutMs: 30_000 },
    )
    stdout = result.stdout
  } catch (err: unknown) {
    if (err instanceof CliError) {
      if (err.notFound) return { ok: false, reason: 'gh not installed' }
      if (err.timedOut) return { ok: false, reason: 'gh timed out' }
      return { ok: false, reason: `gh exit ${err.exitCode}: ${err.stderr.slice(-200)}` }
    }
    throw err
  }

  const issueNumber = parseIssueNumber(stdout)
  if (issueNumber === null) {
    return {
      ok: false,
      reason: `gh returned non-integer issue number: ${JSON.stringify(stdout.trim())}`,
    }
  }
  return { ok: true, issueNumber }
}

/**
 * Append a new issue number to `<evidenceDir>/tech-debt.json`.
 *
 * `scripts/gen-gap.mjs` reads exactly this file (the `issues` number array) to surface filed
 * issues in GAP.md — so recording here is what wires a promoted finding into the gap register
 * with ZERO gen-gap edits.
 *
 * Contract: SINGLE-WRITER. Concurrent invocation may lose entries — callers must serialize.
 * A corrupt existing file resets to `[]` (we never throw on a malformed spool).
 *
 * #2533: this is a data artifact written by tooling, never a generator-emitted target —
 * written with `skipPreserveCheck` so it is never subject to `writeFile`'s
 * `arbiter:preserve` marker, and the `WriteResult` is asserted via `assertWritten` so a
 * write that did not land is a loud failure, never silent.
 */
export function appendTechDebtIssue(evidenceDir: string, issueNumber: number): void {
  const tdPath = join(evidenceDir, 'tech-debt.json')
  let issues: number[] = []
  if (existsSync(tdPath)) {
    const raw = readFileTranslated(tdPath, 'utf-8')
    try {
      const parsed: unknown = JSON.parse(raw)
      // Guard the shape BEFORE dereferencing `.issues`: `JSON.parse('null')`
      // (and scalars/arrays) parse without a SyntaxError, so a `SyntaxError`-only
      // narrowing would let `null.issues` throw a TypeError and break the
      // documented never-throw-on-malformed-spool contract.
      issues =
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Array.isArray((parsed as { issues?: unknown }).issues)
          ? (parsed as { issues: unknown[] }).issues.filter(
              (v): v is number => typeof v === 'number' && Number.isInteger(v),
            )
          : []
      // FAIL-OPEN-INTENT: malformed tech-debt spool resets to [] per the never-throw contract (#1574)
    } catch {
      issues = []
    }
  }
  issues.push(issueNumber)
  const result = writeFile(tdPath, JSON.stringify({ issues }, null, 2) + '\n', {
    skipPreserveCheck: true,
  })
  assertWritten(result, `tech-debt evidence at ${tdPath}`)
}
