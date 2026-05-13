import type { PlanJsonV1 } from "../../types/plan.js";
import type { RuleViolation, VerifyPlanRule } from "./types.js";

const SKIP_MATCHERS = [
  "@Disabled",
  ".skip(",
  "@Ignore",
  "xit".concat("("),
  "xdescribe".concat("("),
  "it.skip",
];

export const skipPatternsRule: VerifyPlanRule = {
  id: "VB-INV-NO-SKIP",
  ssotPointer: { path: "GLOBAL_INVARIANTS.md", anchor: "inv-12" },
  applicability(plan: PlanJsonV1): boolean {
    return plan.files.some(
      (f) =>
        f.changes?.adds_tests === true ||
        f.changes?.modifies_tests === true ||
        (f.changes?.skip_patterns?.length ?? 0) > 0,
    );
  },
  evaluate(plan: PlanJsonV1): RuleViolation[] {
    const violations: RuleViolation[] = [];
    for (const f of plan.files) {
      for (const pattern of f.changes?.skip_patterns ?? []) {
        if (SKIP_MATCHERS.some((m) => pattern.includes(m))) {
          violations.push({
            rule_id: "VB-INV-NO-SKIP",
            severity: "ERROR",
            message: `Skip pattern detected: "${pattern}"`,
            ssot_pointer: { path: "GLOBAL_INVARIANTS.md", anchor: "inv-12" },
            evidence: { paths: [f.path], match: pattern },
          });
        }
      }
    }
    return violations;
  },
};
