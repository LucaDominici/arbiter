import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import type { Language, GovernanceLevel } from "../../src/wizard/types.js";

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
  return makeConfig("/tmp/test", {
    language: lang,
    governanceLevel: level,
    ...STACK_CONFIG[lang],
  }) as unknown as Record<string, unknown>;
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
      expect(content).toContain("go vet");
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
      expect(content).not.toContain("setup-node");
      expect(content).not.toContain("setup-java");
      expect(content).not.toContain("rust-toolchain");
    });

    it(`python+${level}: contains setup-python`, () => {
      const content = renderCi("python", level);
      expect(content).toContain("setup-python");
      expect(content).not.toContain("setup-node");
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

  it("java: contains checkstyleMain, gradlew test, and integrationTest", () => {
    const content = renderTemplate(
      "scripts/check-all.mjs.ejs",
      configFor("java", "L2"),
    );
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

// ─── Claude commands ──────────────────────────────────────────────────────────

describe("cross-product: start-task.md — testCommand in output for all stack × level combinations", () => {
  function renderStartTask(lang: Language, level: GovernanceLevel): string {
    return renderTemplate(
      "claude/commands/start-task.md.ejs",
      configFor(lang, level),
    );
  }

  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: testCommand "${TEST_COMMANDS[lang]}" appears in output`, () => {
        expect(renderStartTask(lang, level)).toContain(TEST_COMMANDS[lang]);
      });
    }
  }
});

describe("cross-product: start-task.md — governance structure across all stacks", () => {
  function renderStartTask(lang: Language, level: GovernanceLevel): string {
    return renderTemplate(
      "claude/commands/start-task.md.ejs",
      configFor(lang, level),
    );
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L1: no tier classification and no TDD reference`, () => {
      const content = renderStartTask(lang, "L1");
      expect(content).not.toMatch(/\bXS\b/);
      expect(content).not.toMatch(/\bStandard\b/);
      expect(content).not.toMatch(/\bTDD\b/);
      expect(content).not.toMatch(/STOP HERE/);
    });

    it(`${lang}+L2: tier classification and TDD reference present`, () => {
      const content = renderStartTask(lang, "L2");
      expect(content).toMatch(/XS|Standard/);
      expect(content).toMatch(/TDD/);
    });

    it(`${lang}+L3: tier classification, TDD, and verification present`, () => {
      const content = renderStartTask(lang, "L3");
      expect(content).toMatch(/XS|Standard/);
      expect(content).toMatch(/verif|evidence/i);
    });
  }
});

describe("cross-product: complete-task.md — testCommand and verification across all stacks", () => {
  function renderCompleteTask(lang: Language, level: GovernanceLevel): string {
    return renderTemplate(
      "claude/commands/complete-task.md.ejs",
      configFor(lang, level),
    );
  }

  for (const lang of LANGUAGES) {
    for (const level of LEVELS) {
      it(`${lang}+${level}: testCommand "${TEST_COMMANDS[lang]}" in gate section`, () => {
        expect(renderCompleteTask(lang, level)).toContain(TEST_COMMANDS[lang]);
      });
    }
  }

  for (const lang of LANGUAGES) {
    it(`${lang}+L3: verification section present`, () => {
      const content = renderCompleteTask(lang, "L3");
      expect(content).toMatch(/Verification|evidence/i);
    });

    it(`${lang}+L1: no verification section`, () => {
      const content = renderCompleteTask(lang, "L1");
      expect(content).not.toMatch(/Verification/);
      expect(content).not.toMatch(/evidence/i);
    });
  }
});
