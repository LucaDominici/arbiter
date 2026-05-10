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
    expect(content).toContain("unused");
  });

  it(".golangci.yml.ejs includes full linter suite: gosec, errcheck, staticcheck", () => {
    const data = makeConfig("/tmp/test", {
      language: "go",
      buildTool: "go",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/.golangci.yml.ejs", data);
    expect(content).toContain("gosec");
    expect(content).toContain("errcheck");
    expect(content).toContain("staticcheck");
    expect(content).toContain("goconst");
  });

  it("pmd-ruleset.xml.ejs renders valid XML with CyclomaticComplexity", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/pmd-ruleset.xml.ejs", data);
    expect(content).toContain("CyclomaticComplexity");
    expect(content).toContain("<?xml");
  });

  it("pmd-ruleset.xml.ejs has all 7 precise categories: SECURITY, MULTITHREADING, ERROR-PRONE", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/pmd-ruleset.xml.ejs", data);
    expect(content).toContain("security.xml");
    expect(content).toContain("multithreading.xml");
    expect(content).toContain("errorprone.xml");
    expect(content).toContain("performance.xml");
    expect(content).toContain("GodClass");
    expect(content).toContain("TooManyMethods");
  });

  // checkstyle.xml.ejs (new — M29)
  it("checkstyle.xml.ejs renders valid XML with precise thresholds", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/checkstyle.xml.ejs", data);
    expect(content).not.toContain("<!DOCTYPE");
    expect(content).toContain("CyclomaticComplexity");
    expect(content).toContain("MethodLength");
    expect(content).toContain("65");
    expect(content).toContain("ParameterNumber");
    expect(content).toContain("7");
    expect(content).toContain("ClassFanOutComplexity");
    expect(content).toContain("FileTabCharacter");
    expect(content).toContain("NewlineAtEndOfFile");
  });

  // spotbugs-exclude.xml.ejs (new — M29)
  it("spotbugs-exclude.xml.ejs contains framework FP suppression but NOT security patterns", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/spotbugs-exclude.xml.ejs", data);
    expect(content).toContain("NP_NONNULL_FIELD");
    expect(content).toContain("EI_EXPOSE_REP");
    expect(content).not.toContain("SQL_INJECTION");
    expect(content).not.toContain("XSS");
    expect(content).not.toContain("COMMAND_INJECTION");
  });

  // spotless.gradle.ejs (new — M29)
  it("spotless.gradle.ejs renders Spotless plugin with Google Java Format", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/spotless.gradle.ejs", data);
    expect(content).toContain("com.diffplug.spotless");
    expect(content).toContain("googleJavaFormat");
    expect(content).toContain("spotlessCheck");
  });

  // eslintrc-static.json.ejs (new — M29)
  it("eslintrc-static.json.ejs renders valid JSON with comprehensive static rules", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/eslintrc-static.json.ejs", data);
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("rules");
    const rules = parsed.rules as Record<string, unknown>;
    expect(rules).toHaveProperty("no-console");
    expect(rules).toHaveProperty("complexity");
    expect(rules).toHaveProperty("max-params");
    expect(rules).toHaveProperty("max-depth");
    expect(rules).toHaveProperty("max-lines-per-function");
    expect(rules).toHaveProperty("max-nested-callbacks");
  });

  it("eslintrc-static.json.ejs sets complexity to 15 and max-params to 5", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/eslintrc-static.json.ejs", data);
    expect(content).toContain("15");
    expect(content).toContain('"max-params"');
    expect(content).toContain("5");
  });

  // prettierrc.json.ejs (new — M29)
  it("prettierrc.json.ejs renders valid JSON with formatting options", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/prettierrc.json.ejs", data);
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("printWidth");
    expect(parsed).toHaveProperty("singleQuote");
    expect(parsed).toHaveProperty("semi");
    expect(parsed).toHaveProperty("tabWidth");
  });

  // ruff.toml.ejs (new — M29)
  it("ruff.toml.ejs renders comprehensive ruff config with complexity and security rules", () => {
    const data = makeConfig("/tmp/test", {
      language: "python",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/ruff.toml.ejs", data);
    expect(content).toContain("C901");
    expect(content).toContain("PLR0911");
    expect(content).toContain("F401");
    expect(content).toContain('"S"');
    expect(content).toContain("max-complexity");
    expect(content).toContain("15");
  });

  it("ruff.toml.ejs includes extend when architectureStyle is hexagonal", () => {
    const data = makeConfig("/tmp/test", {
      language: "python",
      enableDebtGates: true,
      architectureStyle: "hexagonal",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/ruff.toml.ejs", data);
    expect(content).toContain("ruff-boundaries.toml");
  });

  it("ruff.toml.ejs does not extend boundaries for non-hexagonal projects", () => {
    const data = makeConfig("/tmp/test", {
      language: "python",
      enableDebtGates: true,
      architectureStyle: "layered",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/ruff.toml.ejs", data);
    expect(content).not.toContain("ruff-boundaries.toml");
  });

  // spotbugs.gradle.ejs (CANON-04 coverage)
  it("spotbugs.gradle.ejs renders SpotBugs plugin with effort, excludeFilter, and XML report", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/spotbugs.gradle.ejs", data);
    expect(content).toContain("com.github.spotbugs");
    expect(content).toContain("effort");
    expect(content).toContain("excludeFilter");
    expect(content).toContain("spotbugs-exclude.xml");
    expect(content).toContain("main.xml");
  });

  // pmd-ruleset.xml.ejs — codestyle category (Viafera parity #404)
  it("pmd-ruleset.xml.ejs includes codestyle category with Viafera-parity rules", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/pmd-ruleset.xml.ejs", data);
    expect(content).toContain(
      "category/java/codestyle.xml/UnnecessaryFullyQualifiedName",
    );
    expect(content).toContain("category/java/codestyle.xml/UnnecessaryReturn");
    expect(content).toContain("category/java/codestyle.xml/UselessParentheses");
    expect(content).toContain(
      "category/java/codestyle.xml/UselessQualifiedThis",
    );
  });

  // checkstyle.xml.ejs — SuppressWarnings pair (Viafera parity #404)
  it("checkstyle.xml.ejs includes SuppressWarningsHolder and SuppressWarningsFilter pair", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/checkstyle.xml.ejs", data);
    expect(content).toContain("SuppressWarningsHolder");
    expect(content).toContain("SuppressWarningsFilter");
  });

  // spotbugs-exclude.xml.ejs — expanded sections (Viafera parity #404)
  it("spotbugs-exclude.xml.ejs includes CT_CONSTRUCTOR_THROW, URF_UNREAD_FIELD, and Optional-pattern sections", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("debt-gates/spotbugs-exclude.xml.ejs", data);
    expect(content).toContain("CT_CONSTRUCTOR_THROW");
    expect(content).toContain("URF_UNREAD_FIELD");
    expect(content).toContain("NP_NULL_ON_SOME_PATH_FROM_RETURN_VALUE");
    expect(content).toContain("URF_UNREAD_PUBLIC_OR_PROTECTED_FIELD");
  });
});
