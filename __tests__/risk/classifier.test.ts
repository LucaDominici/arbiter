import { describe, it, expect } from "vitest";
import { classifyPath } from "../../src/risk/classifier.js";

describe("classifyPath (#238)", () => {
  it("javascript: classifies migrations as R0 (highest risk)", () => {
    expect(classifyPath("src/db/migrations/001_init.sql", "typescript")).toBe(
      "R0",
    );
  });

  it("javascript: classifies auth code as R1", () => {
    expect(classifyPath("src/auth/login.ts", "typescript")).toBe("R1");
  });

  it("javascript: classifies API handlers as R2", () => {
    expect(classifyPath("src/api/users.ts", "typescript")).toBe("R2");
  });

  it("javascript: classifies UI components as R3", () => {
    expect(classifyPath("src/components/Button.tsx", "typescript")).toBe("R3");
  });

  it("javascript: classifies docs/test scaffolding as R4 (lowest risk)", () => {
    expect(classifyPath("README.md", "typescript")).toBe("R4");
    expect(classifyPath("docs/intro.md", "typescript")).toBe("R4");
  });

  it("python: classifies migrations as R0", () => {
    expect(classifyPath("alembic/versions/001_init.py", "python")).toBe("R0");
  });

  it("python: classifies auth modules as R1", () => {
    expect(classifyPath("app/auth/middleware.py", "python")).toBe("R1");
  });

  it("rust: classifies unsafe blocks as R0", () => {
    expect(classifyPath("src/core/unsafe_ops.rs", "rust")).toBe("R0");
  });

  it("rust: classifies regular .rs files as R2 default", () => {
    expect(classifyPath("src/server/router.rs", "rust")).toBe("R2");
  });

  it("returns R4 (fail-closed default) for unknown languages", () => {
    expect(classifyPath("foo/bar.txt", "unknown" as never)).toBe("R4");
  });

  it("returns R4 on classifier error (invalid input)", () => {
    // Empty path should not crash; defaults to R4
    expect(classifyPath("", "typescript")).toBe("R4");
  });
});
