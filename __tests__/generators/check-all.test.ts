import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCheckAll } from "../../src/generators/check-all.js";
import { makeConfig } from "../helpers.js";

describe("generateCheckAll", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-check-all-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates scripts/check-all.mjs", () => {
    const result = generateCheckAll(makeConfig(dir));
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain("check-all.mjs");
    expect(result.files[0].action).toBe("created");
  });

  it("check-all.mjs has shebang line", () => {
    generateCheckAll(makeConfig(dir));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toMatch(/^#!/);
  });

  it("check-all.mjs contains lint and test commands for TypeScript", () => {
    generateCheckAll(makeConfig(dir, { language: "typescript" }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("eslint");
    expect(content).toContain("npm");
    expect(content).toContain("prettier");
  });

  it("static analysis eslint uses --no-error-on-unmatched-pattern (avoids error on TypeScript-only src)", () => {
    generateCheckAll(makeConfig(dir, { language: "typescript" }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("eslintrc-static.json");
    expect(content).toContain("'--no-error-on-unmatched-pattern'");
    expect(content).not.toContain("'--ext', '.ts,.js'");
  });

  it("check-all.mjs contains Rust commands for Rust projects", () => {
    generateCheckAll(makeConfig(dir, { language: "rust", buildTool: "cargo" }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("fmt");
    expect(content).toContain("clippy");
    expect(content).toContain("cargo");
  });

  it("skips if check-all.mjs already exists", () => {
    const scriptsDir = join(dir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, "check-all.mjs"), "EXISTING");

    const result = generateCheckAll(makeConfig(dir));
    expect(result.files[0].action).toBe("skipped");
    expect(readFileSync(join(scriptsDir, "check-all.mjs"), "utf-8")).toBe(
      "EXISTING",
    );
  });

  it("includes debt ratchet gate at L2 when enableDebtGates is true", () => {
    generateCheckAll(
      makeConfig(dir, { enableDebtGates: true, governanceLevel: "L2" }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("debt-report.mjs");
    expect(content).toContain("--gate");
  });

  it("uses --require-improvement flag at L3", () => {
    generateCheckAll(
      makeConfig(dir, { enableDebtGates: true, governanceLevel: "L3" }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("--require-improvement");
  });

  it("does not include debt ratchet when enableDebtGates is false", () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: false }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("debt-report.mjs");
  });

  it("does NOT include pitest for Java + Gradle (mutation moved to nightly)", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "java",
        buildTool: "gradle",
        enableDebtGates: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("pitest");
  });

  it("does NOT include pitest for Java + Maven (mutation moved to nightly)", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "java",
        buildTool: "maven",
        enableDebtGates: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("pitest");
  });

  it("does not include pitest for Java at L1 (no debt gates)", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "java",
        buildTool: "gradle",
        enableDebtGates: false,
        governanceLevel: "L1",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("pitest");
  });

  it("does not include pitest for non-Java languages at L2", () => {
    for (const lang of ["typescript", "rust", "go", "python"] as const) {
      generateCheckAll(
        makeConfig(dir, {
          language: lang,
          enableDebtGates: true,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("pitest");
    }
  });

  it("includes STRIDE/RACI traceability check at L2 when enableDebtGates is true", () => {
    generateCheckAll(
      makeConfig(dir, { enableDebtGates: true, governanceLevel: "L2" }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("check-stride-traceability.mjs");
    expect(content).toContain("STRIDE");
  });

  it("does not include STRIDE check outside L2 block (appears only within if-level check)", () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    // The check appears inside the `if (level === 'L2')` block — verify that
    const l2BlockStart = content.indexOf("if (level === 'L2')");
    const strideIdx = content.indexOf("check-stride-traceability.mjs");
    expect(l2BlockStart).toBeGreaterThan(-1);
    expect(strideIdx).toBeGreaterThan(l2BlockStart);
  });

  // ─── MG: scaled thresholds ──────────────────────────────────────────────────

  it("fixed profile (default) uses 80% coverage threshold at L2", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        enableDebtGates: true,
        governanceLevel: "L2",
        thresholdProfile: "fixed",
        linesOfCode: 500,
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("80");
    expect(content).toContain("coverage");
  });

  it("scaled profile + LoC<1000 omits coverage gate from generated script", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        enableDebtGates: true,
        governanceLevel: "L2",
        thresholdProfile: "scaled",
        linesOfCode: 500,
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("coverage.thresholds.lines");
  });

  it("scaled profile + LoC>=1000 includes coverage gate with ramped threshold", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        enableDebtGates: true,
        governanceLevel: "L2",
        thresholdProfile: "scaled",
        linesOfCode: 5000,
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("coverage.thresholds.lines");
    // Threshold between 60% and 85% for 5k LoC
    expect(content).toMatch(/coverage\.thresholds\.lines=\d{2}/);
  });

  it("scaled profile + LoC>=10000 uses 85% coverage threshold", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        enableDebtGates: true,
        governanceLevel: "L2",
        thresholdProfile: "scaled",
        linesOfCode: 15_000,
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("coverage.thresholds.lines=85");
  });

  // ─── MK: grace period guard ─────────────────────────────────────────────────

  it("runCheck treats ENOENT as hard failure regardless of grace period", () => {
    generateCheckAll(makeConfig(dir));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("ENOENT");
    expect(content).toContain("binary not found");
  });

  it("generated script includes grace guard block reading arbiter.json", () => {
    generateCheckAll(makeConfig(dir));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("graceActive");
    expect(content).toContain("graceEndsAt");
    expect(content).toContain("graceFromLevel");
    expect(content).toContain("arbiter.json");
  });

  it("generated script includes WARN (grace period) path in runCheck", () => {
    generateCheckAll(makeConfig(dir));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("WARN (grace period)");
  });

  it("generated L2 audit call passes soft option", () => {
    generateCheckAll(makeConfig(dir, { language: "typescript" }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("{ soft: graceActive }");
  });

  it("generated L2 debt ratchet call passes soft option", () => {
    generateCheckAll(
      makeConfig(dir, { enableDebtGates: true, governanceLevel: "L2" }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    const ratchetIdx = content.indexOf("debt-report.mjs");
    expect(ratchetIdx).toBeGreaterThan(-1);
    expect(content.slice(ratchetIdx)).toContain("graceActive");
  });

  // ─── M24: Security scanning ─────────────────────────────────────────────────

  it("PII scan runs before the L1 section (early-fail, not inside L2 block)", () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    const piiIdx = content.indexOf("pii-scan.mjs");
    const l2BlockIdx = content.indexOf("if (level === 'L2')");
    expect(piiIdx).toBeGreaterThan(-1);
    expect(l2BlockIdx).toBeGreaterThan(-1);
    expect(piiIdx).toBeLessThan(l2BlockIdx);
  });

  it("PII scan is a hard fail (no soft: graceActive on pii-scan call)", () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    const piiIdx = content.indexOf("pii-scan.mjs");
    expect(piiIdx).toBeGreaterThan(-1);
    // The runCheck call for pii-scan must not pass { soft: ... }
    const lineEnd = content.indexOf("\n", piiIdx);
    const piiLine = content.slice(
      content.lastIndexOf("\n", piiIdx) + 1,
      lineEnd,
    );
    expect(piiLine).not.toContain("soft");
  });

  it("PII scan also runs at L1 (early-fail not inside L2 block)", () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: "L1",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("pii-scan.mjs");
  });

  it("gitleaks step present in L2 section when enableSecurityScanning is true", () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    const l2BlockIdx = content.indexOf("if (level === 'L2')");
    const gitleaksIdx = content.indexOf("gitleaks", l2BlockIdx);
    expect(l2BlockIdx).toBeGreaterThan(-1);
    expect(gitleaksIdx).toBeGreaterThan(l2BlockIdx);
  });

  it("gitleaks step honors soft: graceActive (ADR-028)", () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    const gitleaksIdx = content.indexOf("gitleaks");
    expect(gitleaksIdx).toBeGreaterThan(-1);
    const callEnd = content.indexOf("\n", gitleaksIdx);
    const callLine = content.slice(
      content.lastIndexOf("\n", gitleaksIdx) + 1,
      callEnd,
    );
    expect(callLine).toContain("graceActive");
  });

  it("Java Gradle: dependencyCheckAnalyze in L2 when enableSecurityScanning", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "java",
        buildTool: "gradle",
        enableSecurityScanning: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    const l2BlockIdx = content.indexOf("if (level === 'L2')");
    expect(
      content.indexOf("dependencyCheckAnalyze", l2BlockIdx),
    ).toBeGreaterThan(l2BlockIdx);
  });

  it("Java Maven: dependency-check-maven in L2 when enableSecurityScanning", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "java",
        buildTool: "maven",
        enableSecurityScanning: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    const l2BlockIdx = content.indexOf("if (level === 'L2')");
    expect(
      content.indexOf("dependency-check-maven", l2BlockIdx),
    ).toBeGreaterThan(l2BlockIdx);
  });

  it("Go: govulncheck in L2 when enableSecurityScanning", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "go",
        buildTool: "go",
        enableSecurityScanning: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    const l2BlockIdx = content.indexOf("if (level === 'L2')");
    expect(content.indexOf("govulncheck", l2BlockIdx)).toBeGreaterThan(
      l2BlockIdx,
    );
  });

  it("enableSecurityScanning=false: no gitleaks, govulncheck, or OWASP DC step", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "java",
        buildTool: "gradle",
        enableSecurityScanning: false,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("gitleaks");
    expect(content).not.toContain("dependencyCheckAnalyze");
    expect(content).not.toContain("pii-scan.mjs");
  });

  it("enableSecurityScanning=false: typescript npm audit absent", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        buildTool: "npm",
        enableSecurityScanning: false,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("npm audit");
  });

  it("enableSecurityScanning=false: rust cargo audit absent", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "rust",
        buildTool: "cargo",
        enableSecurityScanning: false,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("cargo audit");
  });

  it("enableSecurityScanning=false: python pip-audit absent", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "python",
        buildTool: "pip",
        enableSecurityScanning: false,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("pip-audit");
  });

  it("gitleaks command uses --gitleaks-ignore-path not --baseline-path", () => {
    generateCheckAll(
      makeConfig(dir, {
        enableSecurityScanning: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("--gitleaks-ignore-path");
    expect(content).not.toContain("--baseline-path");
  });

  // ─── M26: hasDatabase integration test steps ────────────────────────────────

  describe("M26 hasDatabase integration steps", () => {
    // TypeScript
    it("TypeScript: includes vitest integration step at L2 when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "typescript",
          hasDatabase: true,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).toContain("'vitest', 'run', 'integration'");
    });

    it("TypeScript: omits vitest integration step at L2 when hasDatabase=false", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "typescript",
          hasDatabase: false,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'vitest', 'run', 'integration'");
    });

    it("TypeScript: omits vitest integration step at L1 even when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "typescript",
          hasDatabase: true,
          governanceLevel: "L1",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'vitest', 'run', 'integration'");
    });

    // Java Gradle
    it("Java Gradle: includes integrationTest step at L2 when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "java",
          buildTool: "gradle",
          hasDatabase: true,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).toContain("'integrationTest'");
    });

    it("Java Gradle: omits integrationTest step at L2 when hasDatabase=false", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "java",
          buildTool: "gradle",
          hasDatabase: false,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'integrationTest'");
    });

    it("Java Gradle: omits integrationTest step at L1 even when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "java",
          buildTool: "gradle",
          hasDatabase: true,
          governanceLevel: "L1",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'integrationTest'");
    });

    // Java Maven
    it("Java Maven: includes mvn verify integration step at L2 when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "java",
          buildTool: "maven",
          hasDatabase: true,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).toContain("['verify', '-q']");
    });

    it("Java Maven: omits mvn verify integration step at L2 when hasDatabase=false", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "java",
          buildTool: "maven",
          hasDatabase: false,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("['verify', '-q']");
    });

    it("Java Maven: omits mvn verify integration step at L1 even when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "java",
          buildTool: "maven",
          hasDatabase: true,
          governanceLevel: "L1",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("['verify', '-q']");
    });

    // Rust
    it("Rust: includes cargo test *integration* step at L2 when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "rust",
          buildTool: "cargo",
          hasDatabase: true,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).toContain("'*integration*'");
    });

    it("Rust: omits cargo test *integration* step at L2 when hasDatabase=false", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "rust",
          buildTool: "cargo",
          hasDatabase: false,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'*integration*'");
    });

    it("Rust: omits cargo test *integration* step at L1 even when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "rust",
          buildTool: "cargo",
          hasDatabase: true,
          governanceLevel: "L1",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'*integration*'");
    });

    // Go
    it("Go: includes go test -tags integration step at L2 when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "go",
          buildTool: "go",
          hasDatabase: true,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).toContain("'-tags', 'integration'");
    });

    it("Go: omits go test -tags integration step at L2 when hasDatabase=false", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "go",
          buildTool: "go",
          hasDatabase: false,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'-tags', 'integration'");
    });

    it("Go: omits go test -tags integration step at L1 even when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "go",
          buildTool: "go",
          hasDatabase: true,
          governanceLevel: "L1",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'-tags', 'integration'");
    });

    // Python
    it("Python: includes pytest tests/integration/ step at L2 when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "python",
          buildTool: "pip",
          hasDatabase: true,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).toContain("'tests/integration/'");
    });

    it("Python: omits pytest tests/integration/ step at L2 when hasDatabase=false", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "python",
          buildTool: "pip",
          hasDatabase: false,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'tests/integration/'");
    });

    it("Python: omits pytest tests/integration/ step at L1 even when hasDatabase=true", () => {
      generateCheckAll(
        makeConfig(dir, {
          language: "python",
          buildTool: "pip",
          hasDatabase: true,
          governanceLevel: "L1",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("'tests/integration/'");
    });
  });
});
