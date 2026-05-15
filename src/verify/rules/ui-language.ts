// SPDX-License-Identifier: Apache-2.0
import type { PlanJsonV1 } from '../../types/plan.js'
import type { RuleViolation, VerifyPlanRule } from './types.js'

const FRONTEND_PATH_RE = /^frontend\/src\/.+\.(vue|ts|tsx)$/
const TEST_PATH_RE = /\.(spec|test)\./
const ITALIAN_STOPWORDS_RE = /\b(che|non|anche|per|con|come|nel|della|degli)\b/i

function isUiApplicable(
  path: string,
  addsUiStrings: boolean | undefined,
  uiStringsLen: number,
): boolean {
  return (
    addsUiStrings === true ||
    uiStringsLen > 0 ||
    (FRONTEND_PATH_RE.test(path) && !TEST_PATH_RE.test(path))
  )
}

function checkUiStrings(filePath: string, strings: string[]): RuleViolation[] {
  const violations: RuleViolation[] = []
  for (const s of strings) {
    if (ITALIAN_STOPWORDS_RE.test(s)) {
      violations.push({
        rule_id: 'VB-INV-EN-UI',
        severity: 'ERROR',
        message: `UI string contains Italian text: "${s}"`,
        ssot_pointer: { path: 'GLOBAL_INVARIANTS.md', anchor: 'inv-25' },
        evidence: { paths: [filePath], match: s },
      })
    }
  }
  return violations
}

export const uiLanguageRule: VerifyPlanRule = {
  id: 'VB-INV-EN-UI',
  ssotPointer: { path: 'GLOBAL_INVARIANTS.md', anchor: 'inv-25' },
  applicability(plan: PlanJsonV1): boolean {
    return plan.files.some((f) =>
      isUiApplicable(f.path, f.changes?.adds_ui_strings, f.changes?.ui_strings?.length ?? 0),
    )
  },
  evaluate(plan: PlanJsonV1): RuleViolation[] {
    const violations: RuleViolation[] = []
    for (const f of plan.files) {
      if (!isUiApplicable(f.path, f.changes?.adds_ui_strings, f.changes?.ui_strings?.length ?? 0))
        continue

      const strings = f.changes?.ui_strings ?? []
      if (strings.length > 0) {
        violations.push(...checkUiStrings(f.path, strings))
      } else if (f.changes?.adds_ui_strings === true && plan.invariants?.ui_language !== 'EN') {
        violations.push({
          rule_id: 'VB-INV-EN-UI',
          severity: 'WARN',
          message: `File adds UI strings but invariants.ui_language:"EN" assertion is missing`,
          ssot_pointer: { path: 'GLOBAL_INVARIANTS.md', anchor: 'inv-25' },
          evidence: { paths: [f.path] },
        })
      }
    }
    return violations
  },
}
