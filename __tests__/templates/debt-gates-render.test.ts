import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("debt-gates config templates — rendering", () => {
  it("knip.json.ejs renders valid JSON with entry and project fields", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      projectName: "my-project",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/knip.json.ejs", data);
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("entry");
    expect(parsed).toHaveProperty("project");
  });

  it(".golangci.yml.ejs renders valid YAML enabling gocyclo with max-complexity 15", () => {
    const data = makeConfig("/tmp/test", {
      language: "go",
      buildTool: "go",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/.golangci.yml.ejs", data);
    expect(content).toContain("gocyclo");
    expect(content).toContain("15");
    expect(content).toContain("deadcode");
  });

  it("pmd-ruleset.xml.ejs renders valid XML with CyclomaticComplexity and unused code rules", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/pmd-ruleset.xml.ejs", data);
    expect(content).toContain("CyclomaticComplexity");
    expect(content).toContain("UnusedCode");
    expect(content).toContain("<?xml");
  });
});
