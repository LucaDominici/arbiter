// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'

const ContextBlockIssueField = z.union([
  z.object({ issue: z.string() }),
  z.object({ issues: z.array(z.string()).min(1) }),
])

export const ContextBlockSchema = z.object({
  context: ContextBlockIssueField.and(
    z.object({
      type: z.string(),
      pipeline: z.string(),
      branch_convention: z.string(),
      base_branch: z.string(),
      key_constraints: z.array(z.string()),
      red_team_warnings: z.array(z.string()),
      estimate: z.string(),
    }),
  ),
})
export type ContextBlock = z.infer<typeof ContextBlockSchema>

export const RedTeamFindingSchema = z.object({
  id: z.string(),
  angle: z.enum([
    'security',
    'concurrency',
    'performance',
    'edge-cases',
    'regression',
    'dependency',
    'data-integrity',
    'error-handling',
  ]),
  impact: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'SUGGESTION']),
  description: z.string(),
  recommendation: z.string(),
})
export type RedTeamFinding = z.infer<typeof RedTeamFindingSchema>

export const RedTeamEvidenceV1 = z.object({
  task_id: z.string(),
  timestamp: z.string(),
  agent_count: z.number().int().nonnegative(),
  findings: z.array(RedTeamFindingSchema),
})
export type RedTeamEvidenceV1 = z.infer<typeof RedTeamEvidenceV1>

const FileChanges = z.object({
  adds_ui_strings: z.boolean().optional(),
  ui_strings: z.array(z.string()).optional(),
  adds_tests: z.boolean().optional(),
  modifies_tests: z.boolean().optional(),
  skip_patterns: z.array(z.string()).optional(),
  adds_todos: z.array(z.string()).optional(),
})

const PlanFile = z.object({
  path: z.string(),
  operation: z.enum(['create', 'modify', 'delete']),
  changes: FileChanges.optional(),
})

const ReviewBridge = z.object({
  enabled: z.boolean(),
  reviewer: z.string().default('bridge-reviewer'),
  fail_on_warn: z.boolean().default(false),
})

export const PlanJsonV1 = z.object({
  task_id: z.string().regex(/^#\d+$/),
  scope: z.object({
    track: z.enum(['A', 'B', 'C', 'D']),
    boundaries: z.array(z.string()).optional(),
    paths: z.array(z.string()).optional(),
  }),
  files: z.array(PlanFile),
  invariants: z
    .object({
      ui_language: z.literal('EN').optional(),
      no_skips: z.literal(true).optional(),
    })
    .optional(),
  notes: z.array(z.string()).optional(),
  review_bridge: ReviewBridge,
})
export type PlanJsonV1 = z.infer<typeof PlanJsonV1>

export const ReviewStatus = z.enum(['APPROVED', 'REJECTED', 'SKIPPED', 'ERROR'])
export type ReviewStatus = z.infer<typeof ReviewStatus>

const ViolationSchema = z.object({
  rule_id: z.string(),
  severity: z.enum(['ERROR', 'WARN']),
  message: z.string(),
  ssot_pointer: z.object({ path: z.string(), anchor: z.string() }).nullable(),
  evidence: z.object({
    paths: z.array(z.string()),
    match: z.string().optional(),
  }),
})
export type Violation = z.infer<typeof ViolationSchema>

export const ReviewJsonV1 = z.object({
  timestamp: z.string(),
  task_id: z.string(),
  run_id: z.string(),
  status: ReviewStatus,
  reviewer: z.string(),
  verification: z.object({
    ok: z.boolean(),
    violations: z.array(ViolationSchema),
    notes: z.array(z.string()),
  }),
  blocking: z.boolean(),
  blocking_reason: z.string().nullable(),
})
export type ReviewJsonV1 = z.infer<typeof ReviewJsonV1>
