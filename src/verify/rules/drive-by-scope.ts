import type { PlanJsonV1 } from '../../types/plan.js'
import type { RuleViolation, VerifyPlanRule } from './types.js'

export const driveByScopeRule: VerifyPlanRule = {
  id: 'VB-INV-NO-DRIVEBY',
  ssotPointer: { path: 'TESTING_POLICY.md', anchor: '43' },
  applicability(): boolean {
    return true
  },
  evaluate(plan: PlanJsonV1): RuleViolation[] {
    const violations: RuleViolation[] = []
    const { paths, boundaries } = plan.scope

    if (paths !== undefined && paths.length > 0) {
      const normalizedPaths = paths.map((p) => (p.endsWith('/') ? p : `${p}/`))
      for (const f of plan.files) {
        if (!normalizedPaths.some((p) => f.path.startsWith(p) || f.path === p.slice(0, -1))) {
          violations.push({
            rule_id: 'VB-INV-NO-DRIVEBY',
            severity: 'ERROR',
            message: `File "${f.path}" is outside declared scope paths [${paths.join(', ')}]`,
            ssot_pointer: { path: 'TESTING_POLICY.md', anchor: '43' },
            evidence: { paths: [f.path] },
          })
        }
      }
      return violations
    }

    if (boundaries !== undefined && boundaries.length > 0) {
      for (const f of plan.files) {
        const segment = f.path.split('/')[0] ?? ''
        if (!boundaries.includes(segment)) {
          violations.push({
            rule_id: 'VB-INV-NO-DRIVEBY',
            severity: 'ERROR',
            message: `File "${f.path}" top-level segment "${segment}" is outside declared boundaries [${boundaries.join(', ')}]`,
            ssot_pointer: { path: 'TESTING_POLICY.md', anchor: '43' },
            evidence: { paths: [f.path] },
          })
        }
      }
      return violations
    }

    const segments = new Set(plan.files.map((f) => f.path.split('/')[0] ?? ''))
    if (segments.size > 2) {
      violations.push({
        rule_id: 'VB-INV-NO-DRIVEBY',
        severity: 'ERROR',
        message: `Plan spans ${segments.size} top-level path segments — likely drive-by scope (>2)`,
        ssot_pointer: { path: 'TESTING_POLICY.md', anchor: '43' },
        evidence: { paths: plan.files.map((f) => f.path) },
      })
    } else if (segments.size === 2) {
      violations.push({
        rule_id: 'VB-INV-NO-DRIVEBY',
        severity: 'WARN',
        message: `Plan spans 2 top-level path segments — review for scope creep`,
        ssot_pointer: { path: 'TESTING_POLICY.md', anchor: '43' },
        evidence: { paths: plan.files.map((f) => f.path) },
      })
    }
    return violations
  },
}
