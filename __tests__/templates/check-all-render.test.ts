import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("check-all.mjs.ejs rendering — Java wiring (#404)", () => {
  it("Java Gradle L2 coverageEnabled=false: coverage check omitted", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
      coverageEnabled: false,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).not.toContain("jacocoTestCoverageVerification");
  });

  it("Java Maven L2 coverageEnabled=false: coverage check omitted", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "maven",
      enableDebtGates: true,
      coverageEnabled: false,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).not.toContain("verify -Pjacoco");
  });

  it("Java Gradle L2: SpotBugs uses { soft: graceActive } matching PMD and JaCoCo", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
      coverageEnabled: true,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain(
      "runCheck('spotbugs', './gradlew', ['spotbugsMain', '-q'], { soft: graceActive })",
    );
    // Verify no hard-wired (non-soft) duplicate exists
    const spotbugsLines = content
      .split("\n")
      .filter((l) => l.includes("runCheck('spotbugs'"));
    expect(spotbugsLines).toHaveLength(1);
    expect(spotbugsLines[0]).toContain("graceActive");
  });

  it("Java Maven L2: SpotBugs uses { soft: graceActive } matching PMD and JaCoCo", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "maven",
      enableDebtGates: true,
      coverageEnabled: true,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain(
      "runCheck('spotbugs', 'mvn', ['com.github.spotbugs:spotbugs-maven-plugin:check', '-q'], { soft: graceActive })",
    );
    const spotbugsLines = content
      .split("\n")
      .filter((l) => l.includes("runCheck('spotbugs'"));
    expect(spotbugsLines).toHaveLength(1);
    expect(spotbugsLines[0]).toContain("graceActive");
  });
});

describe("check-all.mjs.ejs rendering — BDD gate (#361)", () => {
  it("TypeScript: emits cucumber-js BDD runCheck", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      governanceLevel: "L2",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain("runCheck('bdd', 'npx', ['cucumber-js']");
  });

  it("Python: emits pytest BDD runCheck", () => {
    const data = makeConfig("/tmp/test", {
      language: "python",
      governanceLevel: "L2",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain(
      "runCheck('bdd', 'pytest', ['-m', 'bdd', 'tests/bdd/']",
    );
  });

  it("Go: emits go test BDD runCheck", () => {
    const data = makeConfig("/tmp/test", {
      language: "go",
      governanceLevel: "L2",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain(
      "runCheck('bdd', 'go', ['test', './internal/bdd/...']",
    );
  });

  it("Java Gradle: emits cucumberTest BDD runCheck", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      governanceLevel: "L2",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain("runCheck('bdd', './gradlew', ['cucumberTest']");
  });

  it("Rust: emits cargo test BDD runCheck", () => {
    const data = makeConfig("/tmp/test", {
      language: "rust",
      governanceLevel: "L2",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain(
      "runCheck('bdd', 'cargo', ['test', '--features', 'bdd']",
    );
  });

  it("TypeScript: @ignore grep step is HARD-fail (soft: false)", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      governanceLevel: "L2",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain("@ignore");
    expect(content).toContain("soft: false");
  });
});

describe("check-all.mjs.ejs rendering — Python e2e gate (#366)", () => {
  it("Python frontend-spa: emits pytest e2e runCheck", () => {
    const data = makeConfig("/tmp/test", {
      language: "python",
      archetype: "frontend-spa",
      governanceLevel: "L2",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain("runCheck('e2e', 'pytest', ['tests/e2e/']");
  });

  it("Python library: does NOT emit pytest e2e runCheck", () => {
    const data = makeConfig("/tmp/test", {
      language: "python",
      archetype: "library",
      governanceLevel: "L2",
      coverageEnabled: false,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).not.toContain("runCheck('e2e', 'pytest', ['tests/e2e/']");
  });
});
