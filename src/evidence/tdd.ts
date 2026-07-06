// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const TddEvidenceV1 = z.object({
  $schemaVersion: z.literal(1),
  task_id: z.string().regex(/^#\d+$/, 'task_id must start with # followed by digits'),
  test_path: z.string().min(1),
  test_commit_sha: z.string().length(40, 'test_commit_sha must be exactly 40 hex characters'),
  test_run_log: z.string(),
  observed_failure: z.string().min(1, 'observed_failure must not be empty'),
  recorded_at: z.iso.datetime({ message: 'recorded_at must be ISO8601' }),
})
export type TddEvidence = z.infer<typeof TddEvidenceV1>

export interface FailureSignatureEntry {
  framework: string
  pattern: RegExp
}

export const FAILURE_SIGNATURES: FailureSignatureEntry[] = [
  { framework: 'vitest', pattern: /FAIL\s+\S+\.test\.[jt]sx?/m },
  { framework: 'jest', pattern: /FAIL\s+\S+\.(spec|test)\.[jt]sx?/m },
  { framework: 'cucumber', pattern: /\d+ scenarios? \(\d+ failed/m },
  { framework: 'pytest', pattern: /={3,}\s*FAILURES\s*={3,}/m },
  { framework: 'gradle', pattern: /FAILED\s*$|BUILD FAILED/m },
  { framework: 'cargo', pattern: /test result: FAILED/m },
  { framework: 'go', pattern: /--- FAIL:/m },
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

export function writeTddEvidence({ repoDir, evidence }: WriteTddEvidenceOptions): string {
  const p = tddEvidencePath(evidence.task_id, repoDir)
  mkdirSync(join(repoDir, '.arbiter', 'evidence', 'tdd'), { recursive: true })
  writeFileSync(p, JSON.stringify(evidence, null, 2) + '\n', 'utf-8')
  return p
}
