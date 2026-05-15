// SPDX-License-Identifier: Apache-2.0
import type { PlanJsonV1, Violation } from '../../types/plan.js'

export interface RuleContext {
  targetDir: string
}

export type RuleViolation = Pick<
  Violation,
  'rule_id' | 'severity' | 'message' | 'ssot_pointer' | 'evidence'
>

export interface VerifyPlanRule {
  id: string
  ssotPointer: { path: string; anchor: string }
  applicability(plan: PlanJsonV1): boolean
  evaluate(plan: PlanJsonV1, ctx: RuleContext): RuleViolation[]
}
