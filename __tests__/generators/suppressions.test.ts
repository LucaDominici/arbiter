import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateSuppressions } from "../../src/generators/suppressions.js";

const EXPECTED_FILES = [
  join("suppressions", "dependency-check-suppressions.xml"),
  join("suppressions", ".gitleaksignore"),
  join("suppressions", "pii-allowlist.json"),
  join("suppressions", "archunit-baseline.json"),
  join("suppressions", "suppressions-schema.json"),
  join("scripts", "check-suppressions.mjs"),
];

describe("generateSuppressions", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("returns empty when enableSuppressions is false", () => {
    const config = makeConfig(dir, { enableSuppressions: false });
    expect(generateSuppressions(config).files).toHaveLength(0);
  });

  it("generates 6 files when enableSuppressions is true", () => {
    const config = makeConfig(dir, { enableSuppressions: true });
    const result = generateSuppressions(config);
    expect(result.files).toHaveLength(6);
  });

  for (const relPath of EXPECTED_FILES) {
    it(`generates ${relPath}`, () => {
      const config = makeConfig(dir, { enableSuppressions: true });
      generateSuppressions(config);
      expect(existsSync(join(dir, relPath))).toBe(true);
    });
  }

  for (const lang of ["typescript", "rust", "go", "python"] as const) {
    it(`generates 6 files for ${lang}`, () => {
      const loopDir = createTestProject(lang);
      initGit(loopDir);
      try {
        const config = makeConfig(loopDir, {
          language: lang,
          enableSuppressions: true,
        });
        const result = generateSuppressions(config);
        expect(result.files).toHaveLength(6);
      } finally {
        cleanupTestProject(loopDir);
      }
    });
  }
});

describe("generateSuppressions — owasp + trivyignore (#208)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("java");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("emits owasp-suppressions.xml + .trivyignore for Java L2", () => {
    const config = makeConfig(dir, {
      language: "java",
      governanceLevel: "L2",
      enableSuppressions: true,
    });
    const result = generateSuppressions(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("owasp-suppressions.xml"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".trivyignore"))).toBe(true);
  });

  it("emits owasp-suppressions.xml + .trivyignore for Kotlin L2", () => {
    const kotlinDir = createTestProject("java");
    initGit(kotlinDir);
    try {
      const config = makeConfig(kotlinDir, {
        language: "kotlin",
        governanceLevel: "L2",
        enableSuppressions: true,
      });
      const result = generateSuppressions(config);
      const paths = result.files.map((f) => f.path);
      expect(paths.some((p) => p.endsWith("owasp-suppressions.xml"))).toBe(
        true,
      );
      expect(paths.some((p) => p.endsWith(".trivyignore"))).toBe(true);
    } finally {
      cleanupTestProject(kotlinDir);
    }
  });

  it("does NOT emit owasp-suppressions.xml for TypeScript L2", () => {
    const tsDir = createTestProject("typescript");
    initGit(tsDir);
    try {
      const config = makeConfig(tsDir, {
        language: "typescript",
        governanceLevel: "L2",
        enableSuppressions: true,
      });
      const result = generateSuppressions(config);
      const paths = result.files.map((f) => f.path);
      expect(paths.some((p) => p.endsWith("owasp-suppressions.xml"))).toBe(
        false,
      );
    } finally {
      cleanupTestProject(tsDir);
    }
  });

  it("does NOT emit .trivyignore for TypeScript L2", () => {
    const tsDir = createTestProject("typescript");
    initGit(tsDir);
    try {
      const config = makeConfig(tsDir, {
        language: "typescript",
        governanceLevel: "L2",
        enableSuppressions: true,
      });
      const result = generateSuppressions(config);
      const paths = result.files.map((f) => f.path);
      expect(paths.some((p) => p.endsWith(".trivyignore"))).toBe(false);
    } finally {
      cleanupTestProject(tsDir);
    }
  });

  it("does NOT emit owasp-suppressions.xml at L1 for Java", () => {
    const config = makeConfig(dir, {
      language: "java",
      governanceLevel: "L1",
      enableSuppressions: true,
    });
    const result = generateSuppressions(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("owasp-suppressions.xml"))).toBe(false);
  });

  it("total files = 8 for Java L2 with enableSuppressions", () => {
    const config = makeConfig(dir, {
      language: "java",
      governanceLevel: "L2",
      enableSuppressions: true,
    });
    const result = generateSuppressions(config);
    expect(result.files).toHaveLength(8);
  });

  it("skipIfExists on owasp-suppressions.xml (CANON-11)", () => {
    const suppressionsDir = join(dir, "suppressions");
    mkdirSync(suppressionsDir, { recursive: true });
    const target = join(suppressionsDir, "owasp-suppressions.xml");
    writeFileSync(target, "PREEXISTING");
    generateSuppressions(
      makeConfig(dir, {
        language: "java",
        governanceLevel: "L2",
        enableSuppressions: true,
      }),
    );
    expect(readFileSync(target, "utf8")).toBe("PREEXISTING");
  });

  it("skipIfExists on .trivyignore (CANON-11)", () => {
    const suppressionsDir = join(dir, "suppressions");
    mkdirSync(suppressionsDir, { recursive: true });
    const target = join(suppressionsDir, ".trivyignore");
    writeFileSync(target, "PREEXISTING");
    generateSuppressions(
      makeConfig(dir, {
        language: "java",
        governanceLevel: "L2",
        enableSuppressions: true,
      }),
    );
    expect(readFileSync(target, "utf8")).toBe("PREEXISTING");
  });
});
