import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateArchUnit } from "../../src/generators/archunit.js";

let dir: string;

beforeEach(() => {
  dir = createTestProject("java");
});

afterEach(() => {
  cleanupTestProject(dir);
});

describe("generateArchUnit", () => {
  it("generates NoMockMvcTest.java for Java projects", () => {
    const config = makeConfig(dir, { language: "java", buildTool: "gradle" });
    const result = generateArchUnit(config);
    expect(result.files.length).toBeGreaterThan(0);
    const noMockMvcFile = result.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    expect(noMockMvcFile).toBeDefined();
    expect(noMockMvcFile!.action).toBe("created");
    expect(existsSync(noMockMvcFile!.path)).toBe(true);
  });

  it("places NoMockMvcTest.java in src/test/java tree", () => {
    const config = makeConfig(dir, { language: "java", buildTool: "gradle" });
    const result = generateArchUnit(config);
    const noMockMvcFile = result.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    expect(noMockMvcFile!.path).toContain("src/test/java");
  });

  it("NoMockMvcTest.java contains ArchUnit imports", () => {
    const config = makeConfig(dir, { language: "java", buildTool: "gradle" });
    const result = generateArchUnit(config);
    const testDir = existsSync(join(dir, "src", "test", "java"));
    expect(testDir).toBe(true);
    const noMockMvcFile = result.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    const content = readFileSync(noMockMvcFile!.path, "utf-8");
    expect(content).toContain("com.tngtech.archunit");
    expect(content).toContain("MockMvc");
    expect(content).toContain("@AnalyzeClasses");
  });

  it("uses basePackage in @AnalyzeClasses when set", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const noMockMvcFile = result.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    const content = readFileSync(noMockMvcFile!.path, "utf-8");
    expect(content).toContain("com.example.myapp");
  });

  it("returns empty files for non-Java projects", () => {
    for (const lang of ["typescript", "rust", "go", "python"] as const) {
      const nonJavaDir = createTestProject(lang);
      try {
        const config = makeConfig(nonJavaDir, { language: lang });
        const result = generateArchUnit(config);
        expect(result.files).toHaveLength(0);
      } finally {
        cleanupTestProject(nonJavaDir);
      }
    }
  });

  it("skips if file already exists", () => {
    const config = makeConfig(dir, { language: "java", buildTool: "gradle" });
    generateArchUnit(config);
    const second = generateArchUnit(config);
    const secondFile = second.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    expect(secondFile?.action).toBe("skipped");
  });
});
