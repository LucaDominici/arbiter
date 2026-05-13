import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectLanguage } from "../../src/detectors/language.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "arbiter-test-"));
}

describe("detectLanguage", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects typescript from package.json", () => {
    writeFileSync(join(dir, "package.json"), "{}");
    expect(detectLanguage(dir)).toBe("typescript");
  });

  it("detects rust from Cargo.toml", () => {
    writeFileSync(join(dir, "Cargo.toml"), "[package]");
    expect(detectLanguage(dir)).toBe("rust");
  });

  it("detects java from build.gradle", () => {
    writeFileSync(join(dir, "build.gradle"), "");
    expect(detectLanguage(dir)).toBe("java");
  });

  it("detects java from pom.xml", () => {
    writeFileSync(join(dir, "pom.xml"), "");
    expect(detectLanguage(dir)).toBe("java");
  });

  it("detects go from go.mod", () => {
    writeFileSync(join(dir, "go.mod"), "");
    expect(detectLanguage(dir)).toBe("go");
  });

  it("detects python from pyproject.toml", () => {
    writeFileSync(join(dir, "pyproject.toml"), "");
    expect(detectLanguage(dir)).toBe("python");
  });

  it("returns unknown for empty dir", () => {
    expect(detectLanguage(dir)).toBe("unknown");
  });

  describe("multi-language (Java+TS monorepo)", () => {
    it("returns typescript when package.json exists alone", () => {
      writeFileSync(join(dir, "package.json"), "{}");
      expect(detectLanguage(dir)).toBe("typescript");
    });

    it("returns multi when package.json and backend/build.gradle both exist", () => {
      writeFileSync(join(dir, "package.json"), "{}");
      mkdirSync(join(dir, "backend"));
      writeFileSync(join(dir, "backend", "build.gradle"), "");
      expect(detectLanguage(dir)).toBe("multi");
    });

    it("returns multi when package.json and root pom.xml both exist", () => {
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "pom.xml"), "");
      expect(detectLanguage(dir)).toBe("multi");
    });

    it("returns multi when package.json and backend/pom.xml both exist", () => {
      writeFileSync(join(dir, "package.json"), "{}");
      mkdirSync(join(dir, "backend"));
      writeFileSync(join(dir, "backend", "pom.xml"), "");
      expect(detectLanguage(dir)).toBe("multi");
    });

    it("returns multi when package.json and backend/build.gradle.kts both exist", () => {
      writeFileSync(join(dir, "package.json"), "{}");
      mkdirSync(join(dir, "backend"));
      writeFileSync(join(dir, "backend", "build.gradle.kts"), "");
      expect(detectLanguage(dir)).toBe("multi");
    });
  });
});
