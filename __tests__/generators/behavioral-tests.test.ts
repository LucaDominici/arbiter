import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateBehavioralTests } from "../../src/generators/behavioral-tests.js";

describe("generateBehavioralTests", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  // ─── TypeScript library: 5 files (example + policy + naming gate + feature + steps) ─────────

  it("returns 5 files for typescript library", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    expect(generateBehavioralTests(config).files).toHaveLength(5);
  });

  it("generates BDD feature file for typescript", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    expect(existsSync(join(dir, "features", "example.feature"))).toBe(true);
  });

  it("generates BDD step definitions for typescript", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    expect(
      existsSync(join(dir, "features", "step_definitions", "example.steps.ts")),
    ).toBe(true);
  });

  it("generates behavioral test example for typescript", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    expect(
      existsSync(join(dir, "src", "test", "example.behavioral.test.ts")),
    ).toBe(true);
  });

  it("generates TESTING_POLICY.md for typescript", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    expect(existsSync(join(dir, "docs", "TESTING_POLICY.md"))).toBe(true);
  });

  it("generates check-test-naming.mjs for typescript", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    expect(existsSync(join(dir, "scripts", "check-test-naming.mjs"))).toBe(
      true,
    );
  });

  // ─── TypeScript frontend-spa: 6 files (+ playwright config + BDD) ──────────────

  it("returns 6 files for typescript frontend-spa", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "frontend-spa",
    });
    expect(generateBehavioralTests(config).files).toHaveLength(6);
  });

  it("generates eslint-playwright.json for frontend-spa", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "frontend-spa",
    });
    generateBehavioralTests(config);
    expect(existsSync(join(dir, ".eslintrc-playwright.json"))).toBe(true);
  });

  it("does NOT generate eslint-playwright.json for non-frontend-spa typescript", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    expect(existsSync(join(dir, ".eslintrc-playwright.json"))).toBe(false);
  });

  // ─── TypeScript example content ───────────────────────────────────────────

  it("typescript example contains describe and it", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    const content = readFileSync(
      join(dir, "src", "test", "example.behavioral.test.ts"),
      "utf-8",
    );
    expect(content).toContain("describe(");
    expect(content).toContain("it(");
  });

  it("typescript example contains given/when/then pattern in comments or names", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    const content = readFileSync(
      join(dir, "src", "test", "example.behavioral.test.ts"),
      "utf-8",
    );
    const lower = content.toLowerCase();
    expect(
      lower.includes("given") ||
        lower.includes("when") ||
        lower.includes("then"),
    ).toBe(true);
  });

  // ─── Java: 5 files (+ BDD feature + BDD suite) ────────────────────────────────────────────────────

  it("returns 5 files for java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        language: "java",
        archetype: "backend-web-db",
        buildTool: "gradle",
      });
      expect(generateBehavioralTests(config).files).toHaveLength(5);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("generates BDD feature file for java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        language: "java",
        archetype: "backend-web-db",
        buildTool: "gradle",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "resources",
            "features",
            "example.feature",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("generates BDD suite class for java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        language: "java",
        archetype: "backend-web-db",
        buildTool: "gradle",
        basePackage: "com.example",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "java",
            "com",
            "example",
            "bdd",
            "ExampleBddIT.java",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("generates ExampleBehavioralTest.java for java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        language: "java",
        archetype: "backend-web-db",
        buildTool: "gradle",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(
          join(
            javaDir,
            "src",
            "test",
            "java",
            "example",
            "ExampleBehavioralTest.java",
          ),
        ),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("java example contains @Nested and @DisplayName", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        language: "java",
        archetype: "backend-web-db",
        buildTool: "gradle",
      });
      generateBehavioralTests(config);
      const content = readFileSync(
        join(
          javaDir,
          "src",
          "test",
          "java",
          "example",
          "ExampleBehavioralTest.java",
        ),
        "utf-8",
      );
      expect(content).toContain("@Nested");
      expect(content).toContain("@DisplayName");
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("java example contains Given/When/Then structure", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        language: "java",
        archetype: "backend-web-db",
        buildTool: "gradle",
      });
      generateBehavioralTests(config);
      const content = readFileSync(
        join(
          javaDir,
          "src",
          "test",
          "java",
          "example",
          "ExampleBehavioralTest.java",
        ),
        "utf-8",
      );
      const lower = content.toLowerCase();
      expect(
        lower.includes("given") ||
          lower.includes("when") ||
          lower.includes("then"),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  // ─── Rust: 5 files (+ BDD feature + BDD test) ────────────────────────────────────────────────────

  it("returns 5 files for rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        language: "rust",
        archetype: "library",
      });
      expect(generateBehavioralTests(config).files).toHaveLength(5);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("generates BDD feature file for rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        language: "rust",
        archetype: "library",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(join(rustDir, "tests", "features", "example.feature")),
      ).toBe(true);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("generates BDD test file for rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        language: "rust",
        archetype: "library",
      });
      generateBehavioralTests(config);
      expect(existsSync(join(rustDir, "tests", "example_bdd_test.rs"))).toBe(
        true,
      );
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("generates example_behavioral_test.rs for rust", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        language: "rust",
        archetype: "library",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(join(rustDir, "tests", "example_behavioral_test.rs")),
      ).toBe(true);
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  it("rust example contains mod tests", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    try {
      const config = makeConfig(rustDir, {
        language: "rust",
        archetype: "library",
      });
      generateBehavioralTests(config);
      const content = readFileSync(
        join(rustDir, "tests", "example_behavioral_test.rs"),
        "utf-8",
      );
      expect(content).toContain("#[cfg(test)]");
    } finally {
      cleanupTestProject(rustDir);
    }
  });

  // ─── Go: 5 files (+ BDD feature + BDD test) ──────────────────────────────────────────────────────

  it("returns 5 files for go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        language: "go",
        archetype: "library",
      });
      expect(generateBehavioralTests(config).files).toHaveLength(5);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("generates BDD feature file for go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        language: "go",
        archetype: "library",
      });
      generateBehavioralTests(config);
      expect(existsSync(join(goDir, "features", "example.feature"))).toBe(true);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("generates BDD test file for go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        language: "go",
        archetype: "library",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(join(goDir, "internal", "bdd", "example_test.go")),
      ).toBe(true);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("generates example_behavioral_test.go for go", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        language: "go",
        archetype: "library",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(join(goDir, "internal", "example_behavioral_test.go")),
      ).toBe(true);
    } finally {
      cleanupTestProject(goDir);
    }
  });

  it("go example contains t.Run with given/when/then naming", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    try {
      const config = makeConfig(goDir, {
        language: "go",
        archetype: "library",
      });
      generateBehavioralTests(config);
      const content = readFileSync(
        join(goDir, "internal", "example_behavioral_test.go"),
        "utf-8",
      );
      expect(content).toContain("t.Run(");
    } finally {
      cleanupTestProject(goDir);
    }
  });

  // ─── Python: 5 files (+ BDD feature + BDD test) ──────────────────────────────────────────────────

  it("returns 5 files for python", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        language: "python",
        archetype: "library",
      });
      expect(generateBehavioralTests(config).files).toHaveLength(5);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  it("generates BDD feature file for python", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        language: "python",
        archetype: "library",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(join(pyDir, "tests", "bdd", "features", "example.feature")),
      ).toBe(true);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  it("generates BDD test file for python", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        language: "python",
        archetype: "library",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(join(pyDir, "tests", "bdd", "test_example_bdd.py")),
      ).toBe(true);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  it("generates test_example_behavioral.py for python", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        language: "python",
        archetype: "library",
      });
      generateBehavioralTests(config);
      expect(
        existsSync(join(pyDir, "tests", "test_example_behavioral.py")),
      ).toBe(true);
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  it("python example contains class and descriptive test methods", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        language: "python",
        archetype: "library",
      });
      generateBehavioralTests(config);
      const content = readFileSync(
        join(pyDir, "tests", "test_example_behavioral.py"),
        "utf-8",
      );
      expect(content).toContain("class Test");
      expect(content).toContain("def test_");
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  // ─── TESTING_POLICY.md content ────────────────────────────────────────────

  it("TESTING_POLICY.md contains mock policy section", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    const content = readFileSync(
      join(dir, "docs", "TESTING_POLICY.md"),
      "utf-8",
    );
    expect(content.toLowerCase()).toContain("mock");
  });

  it("TESTING_POLICY.md contains test naming section", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    const content = readFileSync(
      join(dir, "docs", "TESTING_POLICY.md"),
      "utf-8",
    );
    expect(content.toLowerCase()).toContain("naming");
  });

  it("TESTING_POLICY.md contains project name", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
      projectName: "my-test-proj",
    });
    generateBehavioralTests(config);
    const content = readFileSync(
      join(dir, "docs", "TESTING_POLICY.md"),
      "utf-8",
    );
    expect(content).toContain("my-test-proj");
  });

  it("TESTING_POLICY.md is generated at L1", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
      governanceLevel: "L1",
    });
    generateBehavioralTests(config);
    expect(existsSync(join(dir, "docs", "TESTING_POLICY.md"))).toBe(true);
  });

  it("TESTING_POLICY.md is generated at L3", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
      governanceLevel: "L3",
    });
    generateBehavioralTests(config);
    expect(existsSync(join(dir, "docs", "TESTING_POLICY.md"))).toBe(true);
  });

  // ─── Playwright config content ────────────────────────────────────────────

  it("eslint-playwright.json contains no-force-option rule", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "frontend-spa",
    });
    generateBehavioralTests(config);
    const content = readFileSync(
      join(dir, ".eslintrc-playwright.json"),
      "utf-8",
    );
    expect(content).toContain("no-force-option");
  });

  it("eslint-playwright.json contains no-wait-for-timeout rule", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "frontend-spa",
    });
    generateBehavioralTests(config);
    const content = readFileSync(
      join(dir, ".eslintrc-playwright.json"),
      "utf-8",
    );
    expect(content).toContain("no-wait-for-timeout");
  });

  it("eslint-playwright.json contains no-page-pause rule", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "frontend-spa",
    });
    generateBehavioralTests(config);
    const content = readFileSync(
      join(dir, ".eslintrc-playwright.json"),
      "utf-8",
    );
    expect(content).toContain("no-page-pause");
  });

  // ─── Naming gate content ──────────────────────────────────────────────────

  it("check-test-naming.mjs for typescript checks .test.ts pattern", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    const content = readFileSync(
      join(dir, "scripts", "check-test-naming.mjs"),
      "utf-8",
    );
    expect(content).toContain(".test.ts");
  });

  it("check-test-naming.mjs for java checks Test.java pattern", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        language: "java",
        archetype: "backend-web-db",
        buildTool: "gradle",
      });
      generateBehavioralTests(config);
      const content = readFileSync(
        join(javaDir, "scripts", "check-test-naming.mjs"),
        "utf-8",
      );
      expect(content).toContain("Test.java");
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  it("check-test-naming.mjs for python checks test_ pattern", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    try {
      const config = makeConfig(pyDir, {
        language: "python",
        archetype: "library",
      });
      generateBehavioralTests(config);
      const content = readFileSync(
        join(pyDir, "scripts", "check-test-naming.mjs"),
        "utf-8",
      );
      expect(content).toContain("test_");
    } finally {
      cleanupTestProject(pyDir);
    }
  });

  // ─── Brownfield: skipIfExists (CANON-11) ─────────────────────────────────

  it("does not overwrite existing behavioral test example on re-run", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    const examplePath = join(dir, "src", "test", "example.behavioral.test.ts");
    const original = readFileSync(examplePath, "utf-8");

    // Re-run — must not overwrite
    generateBehavioralTests(config);
    expect(readFileSync(examplePath, "utf-8")).toBe(original);
  });

  it("does not overwrite existing TESTING_POLICY.md on re-run", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    const policyPath = join(dir, "docs", "TESTING_POLICY.md");
    const original = readFileSync(policyPath, "utf-8");

    generateBehavioralTests(config);
    expect(readFileSync(policyPath, "utf-8")).toBe(original);
  });

  // ─── No cross-language file bleed ─────────────────────────────────────────

  it("does not emit java files for typescript", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    expect(
      existsSync(
        join(
          dir,
          "src",
          "test",
          "java",
          "example",
          "ExampleBehavioralTest.java",
        ),
      ),
    ).toBe(false);
  });

  it("does not emit python files for typescript", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      archetype: "library",
    });
    generateBehavioralTests(config);
    expect(existsSync(join(dir, "tests", "test_example_behavioral.py"))).toBe(
      false,
    );
  });
});
