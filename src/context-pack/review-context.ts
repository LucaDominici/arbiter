// SPDX-License-Identifier: Apache-2.0
/**
 * REVIEW_CONTEXT schema and combined-verdict logic for the two-phase checker (#254).
 *
 * Phase 1 (context-checker agent): reads CONTEXT_PACK.md + diff, emits REVIEW_CONTEXT.
 * Phase 2 (bridge-reviewer agent): receives REVIEW_CONTEXT + INV verification result,
 *   applies the combined-verdict matrix to produce a single PASS/REJECT outcome.
 *
 * Combined-verdict matrix:
 *   context=PASS  + inv=PASS  → PASS
 *   context=PASS  + inv≠PASS  → REJECT
 *   context≠PASS  + inv=PASS  → REJECT
 *   context≠PASS  + inv≠PASS  → REJECT
 * Rule: PASS only if BOTH phases pass.
 */
import { z } from 'zod'

export type ContextVerdict = 'PASS' | 'REJECT'
export type InvVerdict = 'PASS' | 'REJECT'
export type FinalVerdict = 'PASS' | 'REJECT'

const FileObservationSchema = z.object({
  path: z.string(),
  observation: z.string(),
  verdict: z.enum(['PASS', 'REJECT']),
})

export type FileObservation = z.infer<typeof FileObservationSchema>

export const ReviewContextSchema = z.object({
  task_id: z.string(),
  track: z.enum(['A', 'B', 'C', 'D']),
  files: z.array(FileObservationSchema),
  invariants_checked: z.array(z.string()),
  context_verdict: z.enum(['PASS', 'REJECT']),
})

export type ReviewContext = z.infer<typeof ReviewContextSchema>

/**
 * Combined-verdict matrix: returns PASS only when both verdicts are PASS.
 */
export function combinedVerdict(context: ContextVerdict, inv: InvVerdict): FinalVerdict {
  return context === 'PASS' && inv === 'PASS' ? 'PASS' : 'REJECT'
}
