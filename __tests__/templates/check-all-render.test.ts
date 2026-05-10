import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("check-all.mjs.ejs rendering — Java wiring (#404)", () => {
  it("Java Gradle L2: SpotBugs uses { soft: graceActive } matching PMD and JaCoCo", () => {
    // Java coverage is always-on in the template (no coverageEnabled guard for Java)
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
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
    // Java coverage is always-on in the template (no coverageEnabled guard for Java)
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "maven",
      enableDebtGates: true,
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
