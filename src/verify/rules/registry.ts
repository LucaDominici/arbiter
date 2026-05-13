import type { VerifyPlanRule } from "./types.js";
import { driveByScopeRule } from "./drive-by-scope.js";
import { orphanTodosRule } from "./orphan-todos.js";
import { skipPatternsRule } from "./skip-patterns.js";
import { uiLanguageRule } from "./ui-language.js";

const BUILT_IN_RULES: VerifyPlanRule[] = [
  uiLanguageRule,
  skipPatternsRule,
  orphanTodosRule,
  driveByScopeRule,
];

export function buildRegistry(extraRules: VerifyPlanRule[] = []): {
  rules: VerifyPlanRule[];
  error?: string;
} {
  const allRules = [...BUILT_IN_RULES, ...extraRules];
  const seen = new Set<string>();
  for (const rule of allRules) {
    if (seen.has(rule.id)) {
      return {
        rules: [],
        error: `Duplicate rule ID "${rule.id}" — extra rules may not shadow built-ins`,
      };
    }
    seen.add(rule.id);
  }
  return { rules: allRules };
}
