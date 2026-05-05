import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import type {
  Language,
  GovernanceLevel,
  InvariantTier,
  InvariantPreset,
} from "../../src/wizard/types.js";
import {
  getFilteredInvariants,
  getInvariantsByTier,
  presetToTiers,
} from "../../src/invariants/filter.js";
import { computeThresholds } from "../../src/config/thresholds.js";
import { generateGlobalInvariants } from "../../src/generators/global-invariants.js";
import { generateNightly } from "../../src/generators/nightly.js";
import { generateContractTesting } from "../../src/generators/contract-testing.js";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TIER_LABELS: Record<InvariantTier, string> = {
  architectural: "Tier 1: Architectural Integrity",
  data: "Tier 2: Data Integrity",
  security: "Tier 3: Security & Compliance",
  operational: "Tier 4: Operational Excellence",
  governance: "Tier 5: Governance",
};

/**
 * INV-11: Cross-product matrix tests — stack × governance level.
 *
 * Existing tests cover each dimension independently (matrix/ per stack,
 * governance/levels per level, templates/commands per stack or per level).
 * This file covers the cross-product combinations for critical paths where
 * both dimensions interact in template logic.
 *
 * All tests use renderTemplate() — no filesystem setup required.
 */

const LANGUAGES: Language[] = ["typescript", "java", "rust", "go", "python"];
const LEVELS: GovernanceLevel[] = ["L1", "L2", "L3"];

const STACK_CONFIG: Record<
  Language,
  Partial<Parameters<typeof makeConfig>[1]>
> = {
  typescript: {
    buildTool: "npm",
    buildCommand: "npm run build",
    testCommand: "npm test",
    lintCommand: "npm run lint",
    formatCommand: "npx prettier --check .",
  },
  java: {
    buildTool: "gradle",
    buildCommand: "./gradlew build",
    testCommand: "./gradlew test",
    lintCommand: "./gradlew checkstyleMain",
    formatCommand: "echo ok",
  },
  rust: {
    buildTool: "cargo",
    buildCommand: "cargo build",
    testCommand: "cargo test",
    lintCommand: "cargo clippy",
    formatCommand: "cargo fmt --check",
  },
  go: {
    buildTool: "go",
    buildCommand: "go build ./...",
    testCommand: "go test ./...",
    lintCommand: "golangci-lint run",
    formatCommand: "gofmt -l .",
  },
  python: {
    buildTool: "pip",
    buildCommand: "pip install -e .",
    testCommand: "pytest",
    lintCommand: "ruff check .",
    formatCommand: "black --check .",
  },
  unknown: {},
};

const TEST_COMMANDS: Record<Language, string> = {
  typescript: "npm test",
  java: "./gradlew test",
  rust: "cargo test",
  go: "go test ./...",
  python: "pytest",
  unknown: "echo",
};

function configFor(
  lang: Language,
  level: GovernanceLevel,
): Record<string, unknown> {
  const config = makeConfig("/tmp/test", {
    language: lang,
    governanceLevel: level,
    ...STACK_CONFIG[lang],
  });
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  });
  // Pre-compute thresholds — same as generateCheckAll does — so templates
  // that reference coverageEnabled/coverageThreshold always receive these values.
  const thresholds = computeThresholds(0, "fixed", level);
  return {
    ...(config as unknown as Record<string, unknown>),
    invariants,
    invariantsByTier: getInvariantsByTier(invariants),
    tierLabels: TIER_LABELS,
    coverageEnabled: thresholds.coverageEnabled,
    coverageThreshold: thresholds.coverageThreshold,
    mutationEnabled: thresholds.mutationEnabled,
    mutationThreshold: thresholds.mutationThreshold,
  };
}

// ─── AGENTS.md ────────────────────────────────────────────────────────────────

describe("cross-product: AGENTS.md — governance policy across all stacks", () => {
  const GOVERNANCE_MARKERS: Record<GovernanceLevel, string> = {
    L1: "70%",
    L2: "80% coverage minimum",
    L3: "85% coverage minimum",
  };

  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: governance policy marker "${GOVERNANCE_MARKERS[level]}" present`, () => {
        const content = renderTemplate(
          "agents-md/AGENTS.md.ejs",
          configFor(lang, level),
        );
        expect(content).toContain(GOVERNANCE_MARKERS[level]);
      });
    }
  }
});

describe("cross-product: AGENTS.md — language invariants isolated at all governance levels", () => {
  for (const level of LEVELS) {
    it(`java+${level}: hexagonal invariant present; no-any absent`, () => {
      const content = renderTemplate(
        "agents-md/AGENTS.md.ejs",
        configFor("java", level),
      );
      expect(content).toContain("Hexagonal architecture");
      expect(content).not.toContain("No `any` type");
      expect(content).not.toContain(".unwrap()");
    });

    it(`rust+${level}: no-unwrap invariant present; hexagonal absent`, () => {
      const content = renderTemplate(
        "agents-md/AGENTS.md.ejs",
        configFor("rust", level),
      );
      expect(content).toContain("No `.unwrap()`");
      expect(content).not.toContain("Hexagonal architecture");
      expect(content).not.toContain("No `any` type");
    });

    it(`go+${level}: Go coding standards present; other stacks absent`, () => {
      const content = renderTemplate(
        "agents-md/AGENTS.md.ejs",
        configFor("go", level),
      );
      expect(content).toContain("error handling");
      expect(content).toContain("golangci-lint");
      expect(content).not.toContain("Strict mode always on");
      expect(content).not.toContain("Hexagonal architecture");
      expect(content).not.toContain("clippy::pedantic");
      expect(content).not.toContain("No `any` type");
    });

    it(`python+${level}: Python coding standards present; other stacks absent`, () => {
      const content = renderTemplate(
        "agents-md/AGENTS.md.ejs",
        configFor("python", level),
      );
      expect(content).toContain("Type annotations");
      expect(content).toContain("ruff");
      expect(content).not.toContain("Strict mode always on");
      expect(content).not.toContain("Hexagonal architecture");
      expect(content).not.toContain("clippy::pedantic");
      expect(content).not.toContain("No `any` type");
    });
  }
});

describe("cross-product: AGENTS.md — L3 SSOT invariant across all stacks", () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L3: SSOT drift invariant present`, () => {
      const content = renderTemplate(
        "agents-md/AGENTS.md.ejs",
        configFor(lang, "L3"),
      );
      expect(content).toContain("SSOT documents must not contradict");
    });

    it(`${lang}+L1: SSOT drift invariant absent`, () => {
      const content = renderTemplate(
        "agents-md/AGENTS.md.ejs",
        configFor(lang, "L1"),
      );
      expect(content).not.toContain("SSOT documents must not contradict");
    });
  }
});

// ─── ci.yml ───────────────────────────────────────────────────────────────────

describe("cross-product: ci.yml — docs-check job across all stacks", () => {
  function renderCi(lang: Language, level: GovernanceLevel): string {
    return renderTemplate("github/workflows/ci.yml.ejs", {
      ...configFor(lang, level),
      useGitHub: true,
    });
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L1: docs-check job absent`, () => {
      const content = renderCi(lang, "L1");
      expect(content).not.toContain("docs-check:");
      expect(content).not.toContain("docs-check");
    });

    it(`${lang}+L2: docs-check job present`, () => {
      const content = renderCi(lang, "L2");
      expect(content).toContain("docs-check:");
    });

    it(`${lang}+L3: docs-check job present`, () => {
      const content = renderCi(lang, "L3");
      expect(content).toContain("docs-check:");
    });
  }
});

describe("cross-product: ci.yml — language setup step across all governance levels", () => {
  function renderCi(lang: Language, level: GovernanceLevel): string {
    return renderTemplate("github/workflows/ci.yml.ejs", {
      ...configFor(lang, level),
      useGitHub: true,
    });
  }

  for (const level of LEVELS) {
    it(`typescript+${level}: contains setup-node`, () => {
      expect(renderCi("typescript", level)).toContain("setup-node");
    });

    it(`java+${level}: contains setup-java`, () => {
      expect(renderCi("java", level)).toContain("setup-java");
    });

    it(`rust+${level}: contains rust-toolchain`, () => {
      expect(renderCi("rust", level)).toContain("rust-toolchain");
    });

    it(`go+${level}: contains setup-go`, () => {
      const content = renderCi("go", level);
      expect(content).toContain("setup-go");
      // L2+ security-early-fail job + L3 classify-changes both add setup-node
      if (level === "L1") expect(content).not.toContain("setup-node");
      expect(content).not.toContain("setup-java");
      expect(content).not.toContain("rust-toolchain");
    });

    it(`python+${level}: contains setup-python`, () => {
      const content = renderCi("python", level);
      expect(content).toContain("setup-python");
      // L2+ security-early-fail job + L3 classify-changes both add setup-node
      if (level === "L1") expect(content).not.toContain("setup-node");
      expect(content).not.toContain("setup-java");
      expect(content).not.toContain("rust-toolchain");
    });
  }
});

// ─── check-all.mjs ────────────────────────────────────────────────────────────

describe("cross-product: check-all.mjs — language check commands", () => {
  // The check-all.mjs template branches on language only; governanceLevel is
  // not an EJS conditional (the L1/L2 distinction is a runtime argument).
  // These tests verify the correct per-language check commands are rendered.

  it("typescript: contains eslint, prettier, npm test, and npm audit", () => {
    const content = renderTemplate(
      "scripts/check-all.mjs.ejs",
      configFor("typescript", "L2"),
    );
    expect(content).toContain("eslint");
    expect(content).toContain("prettier");
    expect(content).toContain("'npm'");
    expect(content).toContain("audit");
  });

  it("java: contains checkstyleMain, gradlew test, and integrationTest (hasDatabase=true)", () => {
    const content = renderTemplate("scripts/check-all.mjs.ejs", {
      ...configFor("java", "L2"),
      hasDatabase: true,
    });
    expect(content).toContain("checkstyleMain");
    expect(content).toContain("gradlew");
    expect(content).toContain("integrationTest");
  });

  it("rust: contains cargo fmt, clippy, cargo test, and cargo audit", () => {
    const content = renderTemplate(
      "scripts/check-all.mjs.ejs",
      configFor("rust", "L2"),
    );
    expect(content).toContain("clippy");
    expect(content).toContain("fmt");
    expect(content).toContain("'cargo'");
    expect(content).toContain("audit");
  });

  it("go: contains go vet, golangci-lint, go test, and staticcheck", () => {
    const content = renderTemplate(
      "scripts/check-all.mjs.ejs",
      configFor("go", "L2"),
    );
    expect(content).toContain("vet");
    expect(content).toContain("golangci-lint");
    expect(content).toContain("'go'");
    expect(content).toContain("staticcheck");
    expect(content).not.toContain("eslint");
    expect(content).not.toContain("checkstyleMain");
    expect(content).not.toContain("clippy");
  });

  it("python: contains ruff check, ruff format, pytest, and pip-audit", () => {
    const content = renderTemplate(
      "scripts/check-all.mjs.ejs",
      configFor("python", "L2"),
    );
    expect(content).toContain("ruff");
    expect(content).toContain("pytest");
    expect(content).toContain("pip-audit");
    expect(content).not.toContain("eslint");
    expect(content).not.toContain("checkstyleMain");
    expect(content).not.toContain("clippy");
  });
});

// ─── Java Maven variant ───────────────────────────────────────────────────────

describe("cross-product: ci.yml — Java Maven variant", () => {
  function renderCiMaven(level: GovernanceLevel): string {
    return renderTemplate("github/workflows/ci.yml.ejs", {
      ...configFor("java", level),
      buildTool: "maven",
      useGitHub: true,
    });
  }

  for (const level of LEVELS) {
    it(`java-maven+${level}: contains mvn; no gradlew; retains setup-java`, () => {
      const content = renderCiMaven(level);
      expect(content).toContain("mvn");
      expect(content).toContain("setup-java");
      expect(content).not.toContain("gradlew");
      expect(content).not.toContain("setup-gradle");
    });
  }
});

// ─── Debt Gates ───────────────────────────────────────────────────────────────

describe("cross-product: check-all.mjs — debt gate checks at L2+, absent at L1", () => {
  const DEBT_GATE_MARKERS: Record<Language, string> = {
    typescript: "knip",
    rust: "tarpaulin",
    java: "jacocoTestCoverageVerification",
    go: "gocyclo",
    python: "cov-fail-under",
    unknown: "",
  };

  for (const lang of LANGUAGES.filter((l) => l !== "unknown")) {
    it(`${lang}+L2: debt gate marker "${DEBT_GATE_MARKERS[lang]}" present`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L2"),
        enableDebtGates: true,
      });
      expect(content).toContain(DEBT_GATE_MARKERS[lang]);
    });

    it(`${lang}+L3: debt gate marker "${DEBT_GATE_MARKERS[lang]}" present`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L3"),
        enableDebtGates: true,
      });
      expect(content).toContain(DEBT_GATE_MARKERS[lang]);
    });

    it(`${lang}+L1: debt gate absent when disabled`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L1"),
        enableDebtGates: false,
      });
      expect(content).not.toContain(DEBT_GATE_MARKERS[lang]);
    });
  }
});

describe("cross-product: check-all.mjs — coverage threshold values at L2 vs L3", () => {
  for (const lang of ["typescript", "rust", "python"] as Language[]) {
    it(`${lang}+L2: coverage threshold is 80`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L2"),
        enableDebtGates: true,
      });
      expect(content).toContain("80");
    });

    it(`${lang}+L3: coverage threshold is 85`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L3"),
        enableDebtGates: true,
      });
      expect(content).toContain("85");
    });
  }
});

describe("cross-product: ci.yml — debt-gates job at L2+, absent at L1", () => {
  function renderCi(
    lang: Language,
    level: GovernanceLevel,
    enableDebtGates: boolean,
  ): string {
    return renderTemplate("github/workflows/ci.yml.ejs", {
      ...configFor(lang, level),
      useGitHub: true,
      enableDebtGates,
    });
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L2: debt-gates job present`, () => {
      const content = renderCi(lang, "L2", true);
      expect(content).toContain("debt-gates:");
    });

    it(`${lang}+L3: debt-gates job present`, () => {
      const content = renderCi(lang, "L3", true);
      expect(content).toContain("debt-gates:");
    });

    it(`${lang}+L1: debt-gates job absent`, () => {
      const content = renderCi(lang, "L1", false);
      expect(content).not.toContain("debt-gates:");
    });
  }
});

describe("cross-product: AGENTS.md — tech debt section at L2+, absent at L1", () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: Tech Debt Gates section present`, () => {
      const content = renderTemplate("agents-md/AGENTS.md.ejs", {
        ...configFor(lang, "L2"),
        enableDebtGates: true,
      });
      expect(content).toContain("Tech Debt Gates");
    });

    it(`${lang}+L3: Tech Debt Gates section present`, () => {
      const content = renderTemplate("agents-md/AGENTS.md.ejs", {
        ...configFor(lang, "L3"),
        enableDebtGates: true,
      });
      expect(content).toContain("Tech Debt Gates");
    });

    it(`${lang}+L1: Tech Debt Gates section absent`, () => {
      const content = renderTemplate("agents-md/AGENTS.md.ejs", {
        ...configFor(lang, "L1"),
        enableDebtGates: false,
      });
      expect(content).not.toContain("Tech Debt Gates");
    });
  }
});

// ─── Claude commands ──────────────────────────────────────────────────────────

describe("cross-product: task.md — testCommand in output for all stack × level combinations", () => {
  function renderTask(lang: Language, level: GovernanceLevel): string {
    return renderTemplate(
      "claude/commands/task.md.ejs",
      configFor(lang, level),
    );
  }

  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: testCommand "${TEST_COMMANDS[lang]}" appears in output`, () => {
        expect(renderTask(lang, level)).toContain(TEST_COMMANDS[lang]);
      });
    }
  }
});

describe("cross-product: task.md — governance structure across all stacks", () => {
  function renderTask(lang: Language, level: GovernanceLevel): string {
    return renderTemplate(
      "claude/commands/task.md.ejs",
      configFor(lang, level),
    );
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L1: no tier classification, has STOP gate`, () => {
      const content = renderTask(lang, "L1");
      expect(content).not.toMatch(/\bXS\b/);
      expect(content).not.toMatch(/\bStandard\b/);
      expect(content).toMatch(/STOP HERE/);
    });

    it(`${lang}+L2: tier classification present`, () => {
      const content = renderTask(lang, "L2");
      expect(content).toMatch(/XS|Standard/);
    });

    it(`${lang}+L3: tier classification and verification present`, () => {
      const content = renderTask(lang, "L3");
      expect(content).toMatch(/XS|Standard/);
      expect(content).toMatch(/verif|evidence/i);
    });
  }
});

describe("cross-product: task.md — testCommand and verification across all stacks", () => {
  function renderTask(lang: Language, level: GovernanceLevel): string {
    return renderTemplate(
      "claude/commands/task.md.ejs",
      configFor(lang, level),
    );
  }

  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: testCommand "${TEST_COMMANDS[lang]}" in gate section`, () => {
        expect(renderTask(lang, level)).toContain(TEST_COMMANDS[lang]);
      });
    }
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L3: verification section present`, () => {
      const content = renderTask(lang, "L3");
      expect(content).toMatch(/Verification|evidence/i);
    });

    it(`${lang}+L1: no verification section`, () => {
      const content = renderTask(lang, "L1");
      expect(content).not.toMatch(/Verification/);
      expect(content).not.toMatch(/evidence/i);
    });
  }
});

// ─── Debt Ratchet ─────────────────────────────────────────────────────────────

describe("cross-product: check-all.mjs — debt ratchet gate at L2+, absent at L1", () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: debt-report.mjs present with --gate`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L2"),
        enableDebtGates: true,
      });
      expect(content).toContain("debt-report.mjs");
      expect(content).toContain("--gate");
    });

    it(`${lang}+L3: debt-report.mjs present with --require-improvement`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L3"),
        enableDebtGates: true,
      });
      expect(content).toContain("debt-report.mjs");
      expect(content).toContain("--require-improvement");
    });

    it(`${lang}+L1: debt-report.mjs absent`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L1"),
        enableDebtGates: false,
      });
      expect(content).not.toContain("debt-report.mjs");
    });
  }
});

describe("cross-product: ci.yml — debt-ratchet job at L2+, absent at L1", () => {
  function renderCi(
    lang: Language,
    level: GovernanceLevel,
    enableDebtGates: boolean,
  ): string {
    return renderTemplate("github/workflows/ci.yml.ejs", {
      ...configFor(lang, level),
      useGitHub: true,
      enableDebtGates,
    });
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L2: debt-ratchet job present`, () => {
      const content = renderCi(lang, "L2", true);
      expect(content).toContain("debt-ratchet:");
    });

    it(`${lang}+L3: debt-ratchet job present with --require-improvement`, () => {
      const content = renderCi(lang, "L3", true);
      expect(content).toContain("debt-ratchet:");
      expect(content).toContain("--require-improvement");
    });

    it(`${lang}+L1: debt-ratchet job absent`, () => {
      const content = renderCi(lang, "L1", false);
      expect(content).not.toContain("debt-ratchet:");
    });
  }
});

describe("cross-product: AGENTS.md — Debt Ratchet section at L2+, absent at L1", () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: Debt Ratchet section present`, () => {
      const content = renderTemplate("agents-md/AGENTS.md.ejs", {
        ...configFor(lang, "L2"),
        enableDebtGates: true,
      });
      expect(content).toContain("Debt Ratchet");
      expect(content).toContain("capture-debt-baseline.mjs");
    });

    it(`${lang}+L3: Debt Ratchet section present`, () => {
      const content = renderTemplate("agents-md/AGENTS.md.ejs", {
        ...configFor(lang, "L3"),
        enableDebtGates: true,
      });
      expect(content).toContain("Debt Ratchet");
    });

    it(`${lang}+L1: Debt Ratchet section absent`, () => {
      const content = renderTemplate("agents-md/AGENTS.md.ejs", {
        ...configFor(lang, "L1"),
        enableDebtGates: false,
      });
      expect(content).not.toContain("Debt Ratchet");
      expect(content).not.toContain("capture-debt-baseline.mjs");
    });
  }
});

// ─── Advanced Hooks (M17) ─────────────────────────────────────────────────────

describe("cross-product: settings.json — advanced hooks governance gating", () => {
  function renderSettings(
    lang: Language,
    level: GovernanceLevel,
  ): Record<string, unknown> {
    const rendered = renderTemplate(
      "claude/settings.json.ejs",
      configFor(lang, level),
    );
    return JSON.parse(rendered) as Record<string, unknown>;
  }

  // PreCompact present at all levels for all stacks
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: PreCompact block present`, () => {
        const json = renderSettings(lang, level);
        const hooks = json["hooks"] as Record<string, unknown>;
        expect(hooks).toHaveProperty("PreCompact");
      });
    }
  }

  // UserPromptSubmit: L2+ only
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: UserPromptSubmit block present`, () => {
      const json = renderSettings(lang, "L2");
      const hooks = json["hooks"] as Record<string, unknown>;
      expect(hooks).toHaveProperty("UserPromptSubmit");
    });

    it(`${lang}+L3: UserPromptSubmit block present`, () => {
      const json = renderSettings(lang, "L3");
      const hooks = json["hooks"] as Record<string, unknown>;
      expect(hooks).toHaveProperty("UserPromptSubmit");
    });

    it(`${lang}+L1: UserPromptSubmit block absent`, () => {
      const json = renderSettings(lang, "L1");
      const hooks = json["hooks"] as Record<string, unknown>;
      expect(hooks).not.toHaveProperty("UserPromptSubmit");
    });
  }

  // pre-edit-plan-anchor in PreToolUse at all levels
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: pre-edit-plan-anchor.mjs in PreToolUse`, () => {
        const rendered = renderTemplate(
          "claude/settings.json.ejs",
          configFor(lang, level),
        );
        expect(rendered).toContain("pre-edit-plan-anchor.mjs");
      });
    }
  }

  // post-edit-dispatch: L2+ only
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: post-edit-dispatch.mjs in PostToolUse`, () => {
      const rendered = renderTemplate(
        "claude/settings.json.ejs",
        configFor(lang, "L2"),
      );
      expect(rendered).toContain("post-edit-dispatch.mjs");
    });

    it(`${lang}+L1: post-edit-dispatch.mjs absent`, () => {
      const rendered = renderTemplate(
        "claude/settings.json.ejs",
        configFor(lang, "L1"),
      );
      expect(rendered).not.toContain("post-edit-dispatch.mjs");
    });
  }

  // debug-state-on-failure: L2+ only, PostToolUseFailure event
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: debug-state-on-failure.mjs present`, () => {
      const rendered = renderTemplate(
        "claude/settings.json.ejs",
        configFor(lang, "L2"),
      );
      expect(rendered).toContain("debug-state-on-failure.mjs");
    });

    it(`${lang}+L1: debug-state-on-failure.mjs absent`, () => {
      const rendered = renderTemplate(
        "claude/settings.json.ejs",
        configFor(lang, "L1"),
      );
      expect(rendered).not.toContain("debug-state-on-failure.mjs");
    });
  }

  // settings.json must be valid JSON for all combinations
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: settings.json is valid JSON`, () => {
        expect(() => renderSettings(lang, level)).not.toThrow();
      });
    }
  }
});

// ─── start-task task state files (M17) ───────────────────────────────────────

describe("cross-product: task.md — task state files for advanced hooks", () => {
  function renderTask(lang: Language, level: GovernanceLevel): string {
    return renderTemplate(
      "claude/commands/task.md.ejs",
      configFor(lang, level),
    );
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L2: contains arbiter task advance instruction`, () => {
      expect(renderTask(lang, "L2")).toContain("arbiter task advance");
    });

    it(`${lang}+L3: contains arbiter task advance instruction`, () => {
      expect(renderTask(lang, "L3")).toContain("arbiter task advance");
    });

    it(`${lang}+L1: does NOT contain arbiter task advance instruction`, () => {
      expect(renderTask(lang, "L1")).not.toContain("arbiter task advance");
    });
  }
});

// ─── PRESET × LANG MATRIX ─────────────────────────────────────────────────────

const PRESETS: InvariantPreset[] = ["essential", "standard", "full"];

const PRESET_EXPECTED_TIERS: Record<InvariantPreset, InvariantTier[]> = {
  essential: ["architectural", "governance"],
  standard: ["architectural", "governance", "data", "operational"],
  full: ["architectural", "governance", "data", "security", "operational"],
};

// INV-11/12/13 are alwaysActive=true at L2+ (M24), so "Tier 3: Security" appears
// in AGENTS.md for all presets at L2+ regardless of tier selection.
const ABSENT_TIERS: Record<InvariantPreset, string[]> = {
  essential: ["Tier 2: Data Integrity", "Tier 4: Operational"],
  standard: [],
  full: [],
};

function configForPreset(
  lang: Language,
  level: GovernanceLevel,
  preset: InvariantPreset,
): Record<string, unknown> {
  const config = makeConfig("/tmp/test", {
    language: lang,
    governanceLevel: level,
    invariantTiers: presetToTiers(preset),
    ...STACK_CONFIG[lang],
  });
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  });
  return {
    ...(config as unknown as Record<string, unknown>),
    invariants,
    invariantsByTier: getInvariantsByTier(invariants),
    tierLabels: TIER_LABELS,
  };
}

describe("cross-product: AGENTS.md — tier headings by preset across all stacks", () => {
  for (const lang of LANGUAGES) {
    for (const preset of PRESETS) {
      const expectedTiers = PRESET_EXPECTED_TIERS[preset];
      const absentTierLabels = ABSENT_TIERS[preset];

      it(`${lang}+${preset}: expected tiers present`, () => {
        const content = renderTemplate(
          "agents-md/AGENTS.md.ejs",
          configForPreset(lang, "L2", preset),
        );
        for (const tier of expectedTiers) {
          expect(content).toContain(TIER_LABELS[tier]);
        }
      });

      if (absentTierLabels.length > 0) {
        it(`${lang}+${preset}: excluded tiers absent`, () => {
          const content = renderTemplate(
            "agents-md/AGENTS.md.ejs",
            configForPreset(lang, "L2", preset),
          );
          for (const label of absentTierLabels) {
            expect(content).not.toContain(label);
          }
        });
      }
    }
  }
});

describe("cross-product: AGENTS.md — always-active invariants present in all presets", () => {
  for (const lang of LANGUAGES) {
    it(`${lang}: INV-21 (TODO refs) present in all presets`, () => {
      for (const preset of PRESETS) {
        const content = renderTemplate(
          "agents-md/AGENTS.md.ejs",
          configForPreset(lang, "L2", preset),
        );
        expect(content).toContain("INV-21");
      }
    });

    it(`${lang}: INV-01 (circular deps) present in all presets`, () => {
      for (const preset of PRESETS) {
        const content = renderTemplate(
          "agents-md/AGENTS.md.ejs",
          configForPreset(lang, "L2", preset),
        );
        expect(content).toContain("INV-01");
      }
    });
  }
});

// ─── Suppressions ─────────────────────────────────────────────────────────────

describe("cross-product: check-all.mjs — suppressions expiry check at all governance levels", () => {
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: suppressions expiry check present when enableSuppressions=true`, () => {
        const content = renderTemplate("scripts/check-all.mjs.ejs", {
          ...configFor(lang, level),
          enableSuppressions: true,
        });
        expect(content).toContain("check-suppressions.mjs");
        expect(content).toContain("suppressions expiry");
      });

      it(`${lang}+${level}: suppressions expiry check absent when enableSuppressions=false`, () => {
        const content = renderTemplate("scripts/check-all.mjs.ejs", {
          ...configFor(lang, level),
          enableSuppressions: false,
        });
        expect(content).not.toContain("check-suppressions.mjs");
      });
    }
  }
});

describe("cross-product: GLOBAL_INVARIANTS.md — generation by preset", () => {
  let dir: string;

  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-cp-global-"));
    return dir;
  };
  const cleanup = (d: string) => rmSync(d, { recursive: true, force: true });

  for (const lang of LANGUAGES) {
    it(`${lang}+essential: GLOBAL_INVARIANTS.md skipped`, () => {
      const d = setup();
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: "L1",
          invariantTiers: presetToTiers("essential"),
          ...STACK_CONFIG[lang],
        });
        const result = generateGlobalInvariants(config);
        expect(result.action).toBe("skipped");
        expect(existsSync(join(d, "GLOBAL_INVARIANTS.md"))).toBe(false);
      } finally {
        cleanup(d);
      }
    });

    it(`${lang}+standard: GLOBAL_INVARIANTS.md created with data/operational tiers`, () => {
      const d = setup();
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: "L2",
          invariantTiers: presetToTiers("standard"),
          ...STACK_CONFIG[lang],
        });
        const result = generateGlobalInvariants(config);
        expect(result.action).toBe("created");
        const content = readFileSync(join(d, "GLOBAL_INVARIANTS.md"), "utf-8");
        expect(content).toContain("Tier 2: Data Integrity");
        expect(content).toContain("Tier 4: Operational Excellence");
        // INV-11/12/13 are alwaysActive=true at L2+ (M24), security tier appears regardless of preset
        expect(content).toContain("Tier 3: Security");
      } finally {
        cleanup(d);
      }
    });

    it(`${lang}+full: GLOBAL_INVARIANTS.md includes all 5 tiers`, () => {
      const d = setup();
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: "L3",
          invariantTiers: presetToTiers("full"),
          ...STACK_CONFIG[lang],
        });
        generateGlobalInvariants(config);
        const content = readFileSync(join(d, "GLOBAL_INVARIANTS.md"), "utf-8");
        expect(content).toContain("Tier 3: Security & Compliance");
        expect(content).toContain("INV-11");
      } finally {
        cleanup(d);
      }
    });
  }
});

// ─── M24: Security scanning cross-product ─────────────────────────────────────

// New M24 dep-audit additions per stack (TS/Rust/Python already had audit steps pre-M24)
const DEP_AUDIT_MARKERS: Partial<Record<Language, string>> = {
  java: "dependencyCheckAnalyze",
  typescript: "audit-level=high",
  rust: "'cargo', ['audit']",
  go: "govulncheck",
  python: "pip-audit",
};

describe("cross-product: check-all.mjs — security scanning (M24)", () => {
  for (const lang of LANGUAGES) {
    it(`${lang}+L2: pii-scan runs before L2 block`, () => {
      const thresholds = computeThresholds(0, "fixed", "L2");
      const cfg = {
        ...configFor(lang, "L2"),
        enableSecurityScanning: true,
        coverageEnabled: thresholds.coverageEnabled,
        coverageThreshold: thresholds.coverageThreshold,
        mutationEnabled: thresholds.mutationEnabled,
      };
      const content = renderTemplate("scripts/check-all.mjs.ejs", cfg);
      const piiIdx = content.indexOf("pii-scan.mjs");
      const l2BlockIdx = content.indexOf("if (level === 'L2')");
      expect(piiIdx).toBeGreaterThan(-1);
      expect(l2BlockIdx).toBeGreaterThan(-1);
      expect(piiIdx).toBeLessThan(l2BlockIdx);
    });

    it(`${lang}+L2: gitleaks step present in L2 block`, () => {
      const thresholds = computeThresholds(0, "fixed", "L2");
      const cfg = {
        ...configFor(lang, "L2"),
        enableSecurityScanning: true,
        coverageEnabled: thresholds.coverageEnabled,
        coverageThreshold: thresholds.coverageThreshold,
        mutationEnabled: thresholds.mutationEnabled,
      };
      const content = renderTemplate("scripts/check-all.mjs.ejs", cfg);
      const l2BlockIdx = content.indexOf("if (level === 'L2')");
      expect(content.indexOf("gitleaks", l2BlockIdx)).toBeGreaterThan(
        l2BlockIdx,
      );
    });

    it(`${lang}+L2: dep-audit step present in L2 block`, () => {
      const thresholds = computeThresholds(0, "fixed", "L2");
      const cfg = {
        ...configFor(lang, "L2"),
        enableSecurityScanning: true,
        coverageEnabled: thresholds.coverageEnabled,
        coverageThreshold: thresholds.coverageThreshold,
        mutationEnabled: thresholds.mutationEnabled,
      };
      const content = renderTemplate("scripts/check-all.mjs.ejs", cfg);
      const marker = DEP_AUDIT_MARKERS[lang];
      if (marker) {
        const l2BlockIdx = content.indexOf("if (level === 'L2')");
        expect(content.indexOf(marker, l2BlockIdx)).toBeGreaterThan(l2BlockIdx);
      }
    });

    it(`${lang}+L1: no gitleaks or dep-audit step (security gates are L2+)`, () => {
      const thresholds = computeThresholds(0, "fixed", "L1");
      const cfg = {
        ...configFor(lang, "L1"),
        enableSecurityScanning: false,
        coverageEnabled: thresholds.coverageEnabled,
        coverageThreshold: thresholds.coverageThreshold,
        mutationEnabled: thresholds.mutationEnabled,
      };
      const content = renderTemplate("scripts/check-all.mjs.ejs", cfg);
      expect(content).not.toContain("gitleaks");
      expect(content).not.toContain("govulncheck");
      expect(content).not.toContain("dependencyCheckAnalyze");
      expect(content).not.toContain("pii-scan.mjs");
    });
  }
});

// ── M23/M25: mutation moved from check-all.mjs → nightly.yml ─────────────────

describe("cross-product: check-all.mjs — mutation commands absent at all levels (M25)", () => {
  const MUTATION_MARKERS: Partial<Record<Language, string>> = {
    typescript: "stryker",
    rust: "mutants",
    python: "mutmut",
  };

  for (const [lang, marker] of Object.entries(MUTATION_MARKERS) as [
    Language,
    string,
  ][]) {
    it(`${lang}+L3: check-all.mjs does NOT contain "${marker}" (moved to nightly)`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L3"),
        enableDebtGates: true,
      });
      expect(content).not.toContain(marker);
    });

    it(`${lang}+L2: check-all.mjs does NOT contain "${marker}"`, () => {
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L2"),
        enableDebtGates: true,
      });
      expect(content).not.toContain(marker);
    });
  }
});

// ── M25: nightly pipeline & evidence harness cross-product assertions ─────────

describe("cross-product: generateNightly — L3 emits nightly files per stack", () => {
  const NIGHTLY_MUTATION_MARKERS: Partial<Record<Language, string>> = {
    typescript: "stryker",
    java: "pitest",
    rust: "mutants",
    python: "mutmut",
  };

  for (const lang of LANGUAGES) {
    it(`${lang}+L3: generateNightly emits 4 files`, () => {
      const d = mkdtempSync(join(tmpdir(), `arbiter-cp-nightly-${lang}-`));
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: "L3",
          acceptBetaTools: true,
          ...STACK_CONFIG[lang],
        });
        const result = generateNightly(config);
        expect(result.files).toHaveLength(4);
        const paths = result.files.map((f) => f.path);
        expect(paths.some((p) => p.endsWith("nightly.yml"))).toBe(true);
        expect(paths.some((p) => p.endsWith("evidence-collect.mjs"))).toBe(
          true,
        );
        expect(paths.some((p) => p.endsWith("ci-classify-changes.mjs"))).toBe(
          true,
        );
        expect(paths.some((p) => p.endsWith(".gitkeep"))).toBe(true);
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    });

    it(`${lang}+L1: generateNightly emits 0 files`, () => {
      const d = mkdtempSync(join(tmpdir(), `arbiter-cp-nightly-${lang}-`));
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: "L1",
          ...STACK_CONFIG[lang],
        });
        expect(generateNightly(config).files).toHaveLength(0);
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    });

    it(`${lang}+L2: generateNightly emits 0 files`, () => {
      const d = mkdtempSync(join(tmpdir(), `arbiter-cp-nightly-${lang}-`));
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: "L2",
          ...STACK_CONFIG[lang],
        });
        expect(generateNightly(config).files).toHaveLength(0);
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    });
  }

  for (const [lang, marker] of Object.entries(NIGHTLY_MUTATION_MARKERS) as [
    Language,
    string,
  ][]) {
    it(`${lang}+L3: nightly.yml contains mutation marker "${marker}"`, () => {
      const d = mkdtempSync(join(tmpdir(), `arbiter-cp-nightly-${lang}-`));
      try {
        const config = makeConfig(d, {
          language: lang,
          governanceLevel: "L3",
          acceptBetaTools: true,
          ...STACK_CONFIG[lang],
        });
        const result = generateNightly(config);
        const f = result.files.find((f) => f.path.endsWith("nightly.yml"));
        expect(f, "nightly.yml not found").toBeDefined();
        const content = readFileSync(f!.path, "utf-8");
        expect(content).toContain(marker);
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    });
  }
});

// ─── M26: Integration testing — hasDatabase gate ──────────────────────────────

describe("cross-product: check-all.mjs — integration test step (M26, hasDatabase gate)", () => {
  // Markers that should appear in rendered check-all.mjs for each language
  // when hasDatabase=true at L2+, and be ABSENT when hasDatabase=false or at L1.
  //
  // java: `integrationTest` is currently rendered unconditionally in the Java branch
  // (no hasDatabase guard yet). After Task 5 (M26) wraps it with
  // `<% if (hasDatabase) %>`, the negative tests (hasDatabase=false) will go GREEN.
  // Until then, the negative tests correctly FAIL in RED.
  //
  // For L1, the check-all.mjs.ejs uses EJS-time `<% if (governanceLevel !== 'L1') %>`
  // guards (to be added in Task 5). Until then, the L1-absent tests correctly FAIL.
  const INTEGRATION_MARKERS: Record<Language, string> = {
    typescript: "integration",
    java: "integrationTest",
    rust: "integration",
    go: "integration",
    python: "tests/integration",
    unknown: "",
  };

  for (const lang of LANGUAGES) {
    for (const level of ["L2", "L3"] as GovernanceLevel[]) {
      it(`${lang}+${level}+hasDatabase=true: integration marker present`, () => {
        const marker = INTEGRATION_MARKERS[lang];
        if (!marker) return;
        const content = renderTemplate("scripts/check-all.mjs.ejs", {
          ...configFor(lang, level),
          hasDatabase: true,
        });
        expect(content).toContain(marker);
      });
    }

    it(`${lang}+L1+hasDatabase=true: integration marker absent (L1 excluded)`, () => {
      const marker = INTEGRATION_MARKERS[lang];
      if (!marker) return;
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L1"),
        hasDatabase: true,
      });
      expect(content).not.toContain(marker);
    });

    it(`${lang}+L2+hasDatabase=false: integration marker absent`, () => {
      const marker = INTEGRATION_MARKERS[lang];
      if (!marker) return;
      const content = renderTemplate("scripts/check-all.mjs.ejs", {
        ...configFor(lang, "L2"),
        hasDatabase: false,
      });
      expect(content).not.toContain(marker);
    });
  }
});

// ─── M27: Behavioral tests — TESTING_POLICY.md.ejs (5 stacks × 3 levels) ────

describe("cross-product: TESTING_POLICY.md — renders for all stacks and levels (INV-11)", () => {
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: renders without error and contains naming section`, () => {
        const content = renderTemplate(
          "behavioral-tests/TESTING_POLICY.md.ejs",
          configFor(lang, level),
        );
        expect(content.toLowerCase()).toContain("naming");
        expect(content.toLowerCase()).toContain("mock");
      });
    }
  }

  it("L2+: E2E policy section present", () => {
    const content = renderTemplate(
      "behavioral-tests/TESTING_POLICY.md.ejs",
      configFor("typescript", "L2"),
    );
    expect(content.toLowerCase()).toContain("e2e");
  });

  it("L1: E2E policy section absent", () => {
    const content = renderTemplate(
      "behavioral-tests/TESTING_POLICY.md.ejs",
      configFor("typescript", "L1"),
    );
    expect(content.toLowerCase()).not.toContain("e2e policy");
  });
});

// ─── M27: check-test-naming.mjs.ejs — naming patterns per stack (5 stacks × 3 levels) ─

describe("cross-product: check-test-naming.mjs — correct patterns per stack (INV-11)", () => {
  const NAMING_PATTERNS: Record<Language, string> = {
    typescript: ".test.ts",
    java: "Test.java",
    rust: "_test.rs",
    go: "_test.go",
    python: "test_",
    unknown: "",
  };

  for (const lang of LANGUAGES) {
    if (!NAMING_PATTERNS[lang]) continue;
    for (const level of LEVELS) {
      it(`${lang}+${level}: naming pattern "${NAMING_PATTERNS[lang]}" present`, () => {
        const content = renderTemplate(
          "scripts/check-test-naming.mjs.ejs",
          configFor(lang, level),
        );
        expect(content).toContain(NAMING_PATTERNS[lang]);
      });
    }
  }
});

// ─── M27: behavioral example templates — render per language ─────────────────

describe("cross-product: behavioral test example templates render per language (INV-11)", () => {
  const EXAMPLE_TEMPLATES: Partial<Record<Language, string>> = {
    java: "behavioral-tests/ExampleBehavioralTest.java.ejs",
    typescript: "behavioral-tests/example.behavioral.test.ts.ejs",
    rust: "behavioral-tests/example_behavioral_test.rs.ejs",
    go: "behavioral-tests/example_behavioral_test.go.ejs",
    python: "behavioral-tests/test_example_behavioral.py.ejs",
  };

  for (const [lang, template] of Object.entries(EXAMPLE_TEMPLATES)) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: renders without error`, () => {
        expect(() =>
          renderTemplate(template, configFor(lang as Language, level)),
        ).not.toThrow();
      });
    }
  }
});

// ─── M27: check-all.mjs.ejs — test naming gate present in L1 ─────────────────

describe("cross-product: check-all.mjs — test naming gate wired in L1 (INV-11/M27)", () => {
  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: check-test-naming.mjs present in gate`, () => {
        const content = renderTemplate(
          "scripts/check-all.mjs.ejs",
          configFor(lang, level),
        );
        expect(content).toContain("check-test-naming.mjs");
      });
    }
  }
});

// ─── M28: Contract testing — generateContractTesting cross-product sweep ──────

const CONTRACT_TYPES = [
  "rest-owned",
  "rest-public",
  "graphql",
  "grpc",
  "message-queue",
] as const;

describe("cross-product: generateContractTesting — no throw for lang × level × contractType (M28)", () => {
  for (const lang of LANGUAGES) {
    for (const level of ["L2", "L3"] as GovernanceLevel[]) {
      for (const contractType of CONTRACT_TYPES) {
        it(`${lang}+${level}+${contractType}: generateContractTesting does not throw`, () => {
          const d = mkdtempSync(
            join(tmpdir(), `arbiter-cp-contract-${lang}-${level}-`),
          );
          try {
            const config = makeConfig(d, {
              language: lang,
              governanceLevel: level,
              contractType,
              basePackage: "com.example",
              ...STACK_CONFIG[lang],
            });
            expect(() => generateContractTesting(config)).not.toThrow();
          } finally {
            rmSync(d, { recursive: true, force: true });
          }
        });
      }
    }
  }
});
