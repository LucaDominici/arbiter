// SPDX-License-Identifier: Apache-2.0
import type { PlanJsonV1 } from '../../types/plan.js'
import type { RuleViolation, VerifyPlanRule } from './types.js'

const TASK_REF_RE = /#\d+|T-[A-Z]+-\d+/

export const orphanTodosRule: VerifyPlanRule = {
  id: 'VB-INV-NO-ORPHAN',
  ssotPointer: { path: 'GLOBAL_INVARIANTS.md', anchor: 'inv-21' },
  applicability(plan: PlanJsonV1): boolean {
    return plan.files.some((f) => (f.changes?.adds_todos?.length ?? 0) > 0)
  },
  evaluate(plan: PlanJsonV1): RuleViolation[] {
    const violations: RuleViolation[] = []
    for (const f of plan.files) {
      for (const todo of f.changes?.adds_todos ?? []) {
        if (!TASK_REF_RE.test(todo)) {
          violations.push({
            rule_id: 'VB-INV-NO-ORPHAN',
            severity: 'ERROR',
            message: `TODO lacks task reference: "${todo}"`,
            ssot_pointer: { path: 'GLOBAL_INVARIANTS.md', anchor: 'inv-21' },
            evidence: { paths: [f.path], match: todo },
          })
        }
      }
    }
    return violations
  },
}
