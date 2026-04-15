import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
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

  for (const lang of ["typescript", "rust", "java", "go", "python"] as const) {
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
