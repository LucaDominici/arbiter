import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateBehavioralTests } from "../../src/generators/behavioral-tests.js";

describe("brownfield: behavioral-tests generator (CANON-11)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("does not overwrite existing behavioral test example on re-run (typescript)", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);

    const examplePath = join(dir, "src", "test", "example.behavioral.test.ts");
    expect(existsSync(examplePath)).toBe(true);
    writeFileSync(examplePath, "// user-edited content");

    generateBehavioralTests(config);
    expect(readFileSync(examplePath, "utf-8")).toBe("// user-edited content");
  });

  it("does not overwrite existing TESTING_POLICY.md on re-run", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);

    const policyPath = join(dir, "docs", "TESTING_POLICY.md");
    expect(existsSync(policyPath)).toBe(true);
    writeFileSync(policyPath, "# user-edited policy");

    generateBehavioralTests(config);
    expect(readFileSync(policyPath, "utf-8")).toBe("# user-edited policy");
  });

  it("always overwrites check-test-naming.mjs on re-run (skipIfExists: false)", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);

    const gatePath = join(dir, "scripts", "check-test-naming.mjs");
    expect(existsSync(gatePath)).toBe(true);
    writeFileSync(gatePath, "// stale gate");

    generateBehavioralTests(config);
    expect(readFileSync(gatePath, "utf-8")).not.toBe("// stale gate");
  });

  it("does not overwrite existing behavioral test example for java on re-run", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        language: "java",
        archetype: "service",
      });
      generateBehavioralTests(config);

      const examplePath = join(
        javaDir,
        "src",
        "test",
        "java",
        "example",
        "ExampleBehavioralTest.java",
      );
      expect(existsSync(examplePath)).toBe(true);
      writeFileSync(examplePath, "// user-edited java test");

      generateBehavioralTests(config);
      expect(readFileSync(examplePath, "utf-8")).toBe(
        "// user-edited java test",
      );
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("does not overwrite existing .eslintrc-playwright.json for frontend-spa typescript", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "frontend-spa",
    });
    generateBehavioralTests(config);

    const playwrightPath = join(dir, ".eslintrc-playwright.json");
    expect(existsSync(playwrightPath)).toBe(true);
    writeFileSync(playwrightPath, '{"user":"edited"}');

    generateBehavioralTests(config);
    expect(readFileSync(playwrightPath, "utf-8")).toBe('{"user":"edited"}');
  });
});
