/**
 * Risk classifier for changed-file paths (#238).
 *
 * Maps a path + stack to one of R0..R4 (R0 = highest risk, R4 = lowest).
 * Used by `arbiter verify evidence` to decide which evidence checks are
 * required for the change set.
 *
 * Fail-closed: if any internal error is thrown OR the stack is not
 * recognised, the result is R4 (lowest risk). Callers MUST treat R4 as
 * the default "needs no extra evidence" bucket — surfacing R4 for an
 * actually-risky file is far less dangerous than surfacing R0 for noise.
 *
 * Rules are deliberately conservative and per-stack — additional stacks
 * fall through to R4 to encourage explicit rule curation before promotion.
 */

import type { Language } from "../wizard/types.js";

export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";

interface Rule {
  /** Regex tested against the normalised forward-slash path. */
  pattern: RegExp;
  level: RiskLevel;
}

/**
 * Rules are evaluated in order; first match wins. Per stack, order matters:
 * highest-risk patterns must be listed first.
 */
const RULES: Partial<Record<Language, Rule[]>> = {
  typescript: [
    { pattern: /(^|\/)migrations?\//i, level: "R0" },
    { pattern: /\.sql$/i, level: "R0" },
    { pattern: /(^|\/)auth\//i, level: "R1" },
    { pattern: /(^|\/)payment(s)?\//i, level: "R1" },
    { pattern: /(^|\/)api\//i, level: "R2" },
    { pattern: /(^|\/)server\//i, level: "R2" },
    { pattern: /(^|\/)components?\//i, level: "R3" },
    { pattern: /(^|\/)pages?\//i, level: "R3" },
    { pattern: /\.md$/i, level: "R4" },
    { pattern: /(^|\/)docs?\//i, level: "R4" },
    { pattern: /(^|\/)__tests__\//, level: "R4" },
  ],
  python: [
    { pattern: /(^|\/)alembic\/versions\//i, level: "R0" },
    { pattern: /(^|\/)migrations?\//i, level: "R0" },
    { pattern: /(^|\/)auth\//i, level: "R1" },
    { pattern: /(^|\/)api\//i, level: "R2" },
    { pattern: /(^|\/)tests?\//i, level: "R4" },
    { pattern: /\.md$/i, level: "R4" },
  ],
  rust: [
    { pattern: /unsafe/i, level: "R0" },
    { pattern: /(^|\/)migrations?\//i, level: "R0" },
    { pattern: /\.rs$/i, level: "R2" },
    { pattern: /\.md$/i, level: "R4" },
  ],
  java: [
    { pattern: /(^|\/)migration(s)?\/.*\.sql$/i, level: "R0" },
    { pattern: /(^|\/)security\//i, level: "R1" },
    { pattern: /\.md$/i, level: "R4" },
  ],
  go: [
    { pattern: /(^|\/)migrations?\//i, level: "R0" },
    { pattern: /(^|\/)auth\//i, level: "R1" },
    { pattern: /\.go$/i, level: "R2" },
    { pattern: /\.md$/i, level: "R4" },
  ],
};

const FAIL_CLOSED_LEVEL: RiskLevel = "R4";

/**
 * Classify a single path. Returns R4 on any unexpected input.
 *
 * @param path  Repository-relative path. Backslashes are normalised to "/".
 * @param stack Language stack (Language from wizard/types).
 */
export function classifyPath(path: string, stack: Language): RiskLevel {
  try {
    if (typeof path !== "string" || path.trim() === "") {
      return FAIL_CLOSED_LEVEL;
    }
    const rules = RULES[stack];
    if (!rules) return FAIL_CLOSED_LEVEL;
    const norm = path.replace(/\\/g, "/");
    for (const rule of rules) {
      if (rule.pattern.test(norm)) {
        return rule.level;
      }
    }
    return FAIL_CLOSED_LEVEL;
  } catch {
    return FAIL_CLOSED_LEVEL;
  }
}
