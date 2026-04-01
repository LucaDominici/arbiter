import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writeFile, copyStaticFile, resolvedPath } from "../../src/utils/fs.js";
import { createTestProject, cleanupTestProject } from "../helpers.js";

describe("writeFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject();
  });
  afterEach(() => {
    cleanupTestProject(dir);
  });

  it('creates a new file and returns "created"', () => {
    const path = join(dir, "test.md");
    const result = writeFile(path, "# Hello");
    expect(result.action).toBe("created");
    expect(readFileSync(path, "utf-8")).toBe("# Hello");
  });

  it("creates parent directories automatically", () => {
    const path = join(dir, "deeply", "nested", "file.txt");
    const result = writeFile(path, "content");
    expect(result.action).toBe("created");
    expect(readFileSync(path, "utf-8")).toBe("content");
  });

  it("skips existing file when skipIfExists=true", () => {
    const path = join(dir, "existing.txt");
    writeFileSync(path, "original");
    const result = writeFile(path, "new content", { skipIfExists: true });
    expect(result.action).toBe("skipped");
    expect(readFileSync(path, "utf-8")).toBe("original");
  });

  it("overwrites existing file when no options set", () => {
    const path = join(dir, "existing.txt");
    writeFileSync(path, "original");
    const result = writeFile(path, "new content");
    expect(result.action).toBe("backed-up-and-replaced");
    expect(readFileSync(path, "utf-8")).toBe("new content");
  });

  it("creates backup file when backup=true", () => {
    const path = join(dir, "governance.md");
    writeFileSync(path, "old content");
    writeFile(path, "new content", { backup: true });
    expect(existsSync(`${path}.arbiter-backup`)).toBe(true);
    expect(readFileSync(`${path}.arbiter-backup`, "utf-8")).toBe("old content");
    expect(readFileSync(path, "utf-8")).toBe("new content");
  });

  it("does not create backup for new file even when backup=true", () => {
    const path = join(dir, "new.md");
    const result = writeFile(path, "content", { backup: true });
    expect(result.action).toBe("created");
    expect(existsSync(`${path}.arbiter-backup`)).toBe(false);
  });

  it("returns the correct path in result", () => {
    const path = join(dir, "test.txt");
    const result = writeFile(path, "data");
    expect(result.path).toBe(path);
  });
});

describe("copyStaticFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject();
  });
  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("copies a file to destination", () => {
    const src = join(dir, "source.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(src, "source content");
    const result = copyStaticFile(src, dest);
    expect(readFileSync(dest, "utf-8")).toBe("source content");
    expect(result.path).toBe(dest);
  });

  it("creates parent directories for destination", () => {
    const src = join(dir, "source.txt");
    const dest = join(dir, "subdir", "dest.txt");
    writeFileSync(src, "content");
    copyStaticFile(src, dest);
    expect(readFileSync(dest, "utf-8")).toBe("content");
  });

  it("skips when destination exists and skipIfExists=true", () => {
    const src = join(dir, "source.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(src, "new content");
    writeFileSync(dest, "old content");
    const result = copyStaticFile(src, dest, { skipIfExists: true });
    expect(result.action).toBe("skipped");
    expect(readFileSync(dest, "utf-8")).toBe("old content");
  });
});

describe("resolvedPath", () => {
  it("joins target directory with path parts", () => {
    expect(resolvedPath("/home/user/project", ".claude", "CLAUDE.md")).toBe(
      join("/home/user/project", ".claude", "CLAUDE.md"),
    );
  });

  it("handles single part", () => {
    expect(resolvedPath("/tmp", "file.txt")).toBe(join("/tmp", "file.txt"));
  });

  it("handles multiple parts", () => {
    expect(resolvedPath("/root", "a", "b", "c")).toBe(
      join("/root", "a", "b", "c"),
    );
  });
});
