import type { Language, StrictnessTier } from "../wizard/types.js";

export interface StrictnessTierRules {
  /** TypeScript: enable noUncheckedIndexedAccess in tsconfig */
  noUncheckedIndexedAccess: boolean;
  /** TypeScript: enable strictFunctionTypes */
  strictFunctionTypes: boolean;
  /** TypeScript/ESLint: max cyclomatic complexity threshold */
  eslintMaxComplexity: number;
  /** Rust: pass -W clippy::pedantic to cargo clippy */
  clippyPedantic: boolean;
  /** Java: extra Checkstyle rule modules beyond the standard set */
  checkstyleExtraRules: string[];
  /** Go: extra golangci-lint linters beyond the standard suite */
  golangciExtraLinters: string[];
  /** Python: extra ruff rule prefixes to enforce */
  ruffExtraRules: string[];
}

const PRACTICAL_BASE: StrictnessTierRules = {
  noUncheckedIndexedAccess: false,
  strictFunctionTypes: true,
  eslintMaxComplexity: 15,
  clippyPedantic: false,
  checkstyleExtraRules: [],
  golangciExtraLinters: [],
  ruffExtraRules: [],
};

const PEDANTIC_OVERRIDES: Partial<StrictnessTierRules> = {
  noUncheckedIndexedAccess: true,
  eslintMaxComplexity: 10,
  clippyPedantic: true,
  checkstyleExtraRules: ["MagicNumber", "VisibilityModifier", "FinalClass"],
  golangciExtraLinters: ["exhaustruct", "wrapcheck", "ireturn"],
  ruffExtraRules: ["ANN", "D", "TCH"],
};

/**
 * Return the enforcement rule set for a given language × strictness tier.
 * Pedantic tier layers additional rules on top of practical.
 */
export function getStrictnessTierRules(
  _language: Language,
  tier: StrictnessTier,
): StrictnessTierRules {
  if (tier === "practical") return { ...PRACTICAL_BASE };

  // pedantic: start from practical, apply overrides
  const pedantic: StrictnessTierRules = {
    ...PRACTICAL_BASE,
    ...PEDANTIC_OVERRIDES,
    // Arrays need explicit spread to avoid reference sharing
    checkstyleExtraRules: [...(PEDANTIC_OVERRIDES.checkstyleExtraRules ?? [])],
    golangciExtraLinters: [...(PEDANTIC_OVERRIDES.golangciExtraLinters ?? [])],
    ruffExtraRules: [...(PEDANTIC_OVERRIDES.ruffExtraRules ?? [])],
  };

  return pedantic;
}
