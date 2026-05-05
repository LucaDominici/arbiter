import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { detectLanes } from "../../src/detectors/lanes.js";
import { cleanupTestProject } from "../helpers.js";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "arbiter-lanes-"));
}

describe("detectLanes", () => {
  let dir: string;

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("returns empty array for an empty repo", () => {
    dir = makeTmp();
    expect(detectLanes(dir).lanes).toEqual([]);
  });

  it("detects frontend lane from frontend/package.json with react", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "frontend"));
    writeFileSync(
      join(dir, "frontend", "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    );
    expect(detectLanes(dir).lanes).toContain("frontend");
  });

  it("does NOT detect frontend lane if frontend/package.json missing", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "frontend"));
    expect(detectLanes(dir).lanes).not.toContain("frontend");
  });

  it("does NOT detect frontend lane if package.json has no known FE framework", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "frontend"));
    writeFileSync(
      join(dir, "frontend", "package.json"),
      JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
    );
    expect(detectLanes(dir).lanes).not.toContain("frontend");
  });

  it("detects backend lane from backend/pom.xml", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "backend"));
    writeFileSync(join(dir, "backend", "pom.xml"), "<project/>");
    expect(detectLanes(dir).lanes).toContain("backend");
  });

  it("detects backend lane from backend/go.mod", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "backend"));
    writeFileSync(
      join(dir, "backend", "go.mod"),
      "module example.com/api\n\ngo 1.22",
    );
    expect(detectLanes(dir).lanes).toContain("backend");
  });

  it("does NOT detect docs lane when docs/ is empty (no .md files)", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "docs"));
    expect(detectLanes(dir).lanes).not.toContain("docs");
  });

  it("detects docs lane when docs/ contains a .md file", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "README.md"), "# Docs");
    expect(detectLanes(dir).lanes).toContain("docs");
  });

  it("detects all three lanes when FE + BE + docs present", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "frontend"));
    writeFileSync(
      join(dir, "frontend", "package.json"),
      JSON.stringify({ dependencies: { vue: "^3.0.0" } }),
    );
    mkdirSync(join(dir, "backend"));
    writeFileSync(join(dir, "backend", "build.gradle"), "");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "index.md"), "");
    const { lanes } = detectLanes(dir);
    expect(lanes).toContain("frontend");
    expect(lanes).toContain("backend");
    expect(lanes).toContain("docs");
    expect(lanes).toHaveLength(3);
  });

  it("detects frontend + backend only (no docs)", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "frontend"));
    writeFileSync(
      join(dir, "frontend", "package.json"),
      JSON.stringify({ dependencies: { svelte: "^4.0.0" } }),
    );
    mkdirSync(join(dir, "backend"));
    writeFileSync(join(dir, "backend", "Cargo.toml"), "[package]");
    const { lanes } = detectLanes(dir);
    expect(lanes).toContain("frontend");
    expect(lanes).toContain("backend");
    expect(lanes).not.toContain("docs");
  });

  it("detects backend via package.json with express", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "backend"));
    writeFileSync(
      join(dir, "backend", "package.json"),
      JSON.stringify({ dependencies: { express: "^4.0.0" } }),
    );
    expect(detectLanes(dir).lanes).toContain("backend");
  });

  it("detects docs from nested .md file one level deep", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "docs", "sub"), { recursive: true });
    writeFileSync(join(dir, "docs", "sub", "page.md"), "# Page");
    expect(detectLanes(dir).lanes).toContain("docs");
  });

  it("result is idempotent (same dir same result)", () => {
    dir = makeTmp();
    mkdirSync(join(dir, "backend"));
    writeFileSync(join(dir, "backend", "go.mod"), "module x\n\ngo 1.22");
    expect(detectLanes(dir)).toEqual(detectLanes(dir));
  });
});
