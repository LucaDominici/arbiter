import type { ArbiterConfigV2 } from "./schema.js";

export type GeneratorKey =
  | "agents-md"
  | "global-invariants"
  | "claude"
  | "codex"
  | "cursor"
  | "copilot"
  | "skills"
  | "agents-claude"
  | "github"
  | "root"
  | "check-all"
  | "debt-gates"
  | "debt-ratchet"
  | "coverage"
  | "suppressions"
  | "security"
  | "archunit"
  | "eslint-boundaries"
  | "rust-boundaries"
  | "go-boundaries"
  | "python-boundaries"
  | "mutation"
  | "nightly"
  | "integration-testing"
  | "contract-testing"
  | "stride-enforcement"
  | "evidence-retention"
  | "test-taxonomy"
  | "behavioral-tests"
  | "playwright-python"
  | "ssot"
  | "githooks"
  | "github-setup"
  | "docs"
  | "api-middleware";

export interface ConfigDiff {
  paths: string[];
}

const AXIS_FIELDS = new Set([
  "governanceLevel",
  "archetype",
  "architectureStyle",
  "isMultiTenant",
  "hasDatabase",
  "hasPublicApi",
  "contractType",
]);

// Normalize undefined optional fields to their semantic defaults so
// that a stored "none"/"false" doesn't diff against a user config that
// simply omits the key (both mean the same thing).
const FIELD_DEFAULTS: Record<string, unknown> = {
  contractType: "none",
  architectureStyle: "none",
  archetype: "library",
  isMultiTenant: false,
  hasDatabase: false,
  hasPublicApi: false,
};

function normField(key: string, val: unknown): unknown {
  if (val === undefined && key in FIELD_DEFAULTS) return FIELD_DEFAULTS[key];
  return val;
}

type ImpactedSet = Set<GeneratorKey | "*">;

const PATH_TO_KEYS: Readonly<Record<string, GeneratorKey[]>> = {
  // githooks is always-on (enabled: true in registry). It lives under the
  // `tools` key as belt-and-suspenders: any tool change should re-run the
  // githooks generator because tool config can affect which gate steps the
  // generated hooks invoke.
  tools: [
    "agents-md",
    "claude",
    "codex",
    "cursor",
    "copilot",
    "skills",
    "agents-claude",
    "githooks",
  ],
  useGitHub: ["github", "root", "check-all"],
  "features.debtGates": [
    "debt-gates",
    "debt-ratchet",
    "coverage",
    "stride-enforcement",
  ],
  "features.securityScanning": ["security"],
  "features.mutationTesting": ["mutation", "check-all", "nightly"],
  "features.contractTesting": [
    "contract-testing",
    "integration-testing",
    "github",
  ],
  "features.evidenceHarness": ["evidence-retention", "nightly"],
  "features.suppressions": ["suppressions"],
  "thresholds.lineCoverage": ["check-all", "coverage"],
  "thresholds.branchCoverage": ["check-all", "coverage"],
  "thresholds.mutationScore": ["mutation", "check-all"],
  "thresholds.cyclomaticComplexity": ["debt-gates"],
  "thresholds.methodLength": ["debt-gates"],
  "thresholds.maxParams": ["debt-gates"],
  invariantTiers: ["global-invariants", "agents-md"],
};

function diffLeaf(
  prefix: string,
  a: unknown,
  b: unknown,
  paths: string[],
): void {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) paths.push(prefix);
    return;
  }
  if (
    typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null
  ) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      diffLeaf(
        `${prefix}.${k}`,
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        paths,
      );
    }
    return;
  }
  if (a !== b) paths.push(prefix);
}

export function diffConfig(
  stored: ArbiterConfigV2,
  next: ArbiterConfigV2,
): ConfigDiff {
  const paths: string[] = [];
  const s = stored as unknown as Record<string, unknown>;
  const n = next as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(s), ...Object.keys(n)]);
  for (const k of keys) {
    const a = normField(k, s[k]);
    const b = normField(k, n[k]);
    if (k === "features" || k === "thresholds") {
      diffLeaf(k, a, b, paths);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      paths.push(k);
    }
  }
  return { paths };
}

export function impactedGenerators(diff: ConfigDiff): ImpactedSet {
  const result: ImpactedSet = new Set();

  for (const path of diff.paths) {
    if (AXIS_FIELDS.has(path)) {
      result.add("*");
      return result;
    }
  }

  for (const path of diff.paths) {
    const keys = PATH_TO_KEYS[path];
    if (keys) {
      for (const k of keys) result.add(k);
    }
  }

  return result;
}
