import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateSecurity } from "../../src/generators/security.js";

const BASE_FILES = [
  join("scripts", "pii-scan.mjs"),
  ".gitleaks.toml",
  join(".claude", "hooks", "check-no-pii.mjs"),
];

describe("generateSecurity", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("returns empty when enableSecurityScanning is false", () => {
    const config = makeConfig(dir, { enableSecurityScanning: false });
    expect(generateSecurity(config).files).toHaveLength(0);
  });

  it("generates 3 files for non-Java stacks", () => {
    const config = makeConfig(dir, {
      enableSecurityScanning: true,
      language: "typescript",
    });
    const result = generateSecurity(config);
    expect(result.files).toHaveLength(3);
  });

  it("generates 4 files for Java (includes OWASP DC snippet)", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        enableSecurityScanning: true,
        language: "java",
        buildTool: "gradle",
      });
      const result = generateSecurity(config);
      expect(result.files).toHaveLength(4);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  for (const file of BASE_FILES) {
    it(`generates ${file} for TypeScript`, () => {
      const config = makeConfig(dir, { enableSecurityScanning: true });
      generateSecurity(config);
      expect(existsSync(join(dir, file))).toBe(true);
    });
  }

  it("generates config/owasp-dependency-check.gradle for Java", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    try {
      const config = makeConfig(javaDir, {
        enableSecurityScanning: true,
        language: "java",
        buildTool: "gradle",
      });
      generateSecurity(config);
      expect(
        existsSync(join(javaDir, "config", "owasp-dependency-check.gradle")),
      ).toBe(true);
    } finally {
      cleanupTestProject(javaDir);
    }
  });

  for (const lang of ["typescript", "rust", "go", "python"] as const) {
    it(`does not generate OWASP DC snippet for ${lang}`, () => {
      const langDir = createTestProject(lang);
      initGit(langDir);
      try {
        const config = makeConfig(langDir, {
          enableSecurityScanning: true,
          language: lang,
        });
        generateSecurity(config);
        expect(
          existsSync(join(langDir, "config", "owasp-dependency-check.gradle")),
        ).toBe(false);
      } finally {
        cleanupTestProject(langDir);
      }
    });
  }

  it("pii-scan.mjs reads pii-allowlist.json suppression file", () => {
    const config = makeConfig(dir, { enableSecurityScanning: true });
    generateSecurity(config);
    const content = readFileSync(join(dir, "scripts", "pii-scan.mjs"), "utf-8");
    expect(content).toContain("pii-allowlist.json");
  });

  it("pii-scan.mjs contains email regex pattern", () => {
    const config = makeConfig(dir, { enableSecurityScanning: true });
    generateSecurity(config);
    const content = readFileSync(join(dir, "scripts", "pii-scan.mjs"), "utf-8");
    expect(content).toContain("@");
  });

  it(".gitleaks.toml references .gitleaksignore", () => {
    const config = makeConfig(dir, { enableSecurityScanning: true });
    generateSecurity(config);
    const content = readFileSync(join(dir, ".gitleaks.toml"), "utf-8");
    expect(content).toContain(".gitleaksignore");
  });

  it("pii-scan.mjs validates allowlist is array (not bare catch)", () => {
    const config = makeConfig(dir, { enableSecurityScanning: true });
    generateSecurity(config);
    const content = readFileSync(join(dir, "scripts", "pii-scan.mjs"), "utf-8");
    expect(content).toContain("Array.isArray");
    expect(content).toContain("process.exit(1)");
    expect(content).not.toContain("/* ignore malformed allowlist */");
  });

  it("pii-scan.mjs isAllowed requires at least one filter field", () => {
    const config = makeConfig(dir, { enableSecurityScanning: true });
    generateSecurity(config);
    const content = readFileSync(join(dir, "scripts", "pii-scan.mjs"), "utf-8");
    expect(content).toContain("!entry.file && !entry.line && !entry.pattern");
  });

  for (const lang of ["typescript", "rust", "go", "python", "java"] as const) {
    it(`generates base files for ${lang}`, () => {
      const langDir = createTestProject(lang);
      initGit(langDir);
      try {
        const config = makeConfig(langDir, {
          enableSecurityScanning: true,
          language: lang,
        });
        generateSecurity(config);
        for (const file of BASE_FILES) {
          expect(existsSync(join(langDir, file))).toBe(true);
        }
      } finally {
        cleanupTestProject(langDir);
      }
    });
  }
});
