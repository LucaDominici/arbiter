import { describe, it, expect } from "vitest";
import { getLanguageHooks } from "../../src/detectors/language-hooks.js";

describe("getLanguageHooks", () => {
  it("always includes orphan TODO hook", () => {
    for (const lang of [
      "typescript",
      "rust",
      "java",
      "go",
      "python",
      "unknown",
    ] as const) {
      const hooks = getLanguageHooks(lang);
      expect(hooks.some((h) => h.name === "check-no-orphan-todo.mjs")).toBe(
        true,
      );
    }
  });

  it("includes no-any hook for typescript", () => {
    const hooks = getLanguageHooks("typescript");
    const noAny = hooks.find((h) => h.name === "check-no-any.mjs");
    expect(noAny).toBeDefined();
    expect(noAny!.body).toContain(".ts");
    expect(noAny!.description).toContain("any");
  });

  it("includes no-unwrap hook for rust", () => {
    const hooks = getLanguageHooks("rust");
    const noUnwrap = hooks.find((h) => h.name === "check-no-unwrap.mjs");
    expect(noUnwrap).toBeDefined();
    expect(noUnwrap!.body).toContain(".unwrap()");
    expect(noUnwrap!.description).toContain("unwrap");
  });

  it("does not include no-any for non-typescript", () => {
    for (const lang of ["rust", "java", "go", "python", "unknown"] as const) {
      const hooks = getLanguageHooks(lang);
      expect(hooks.some((h) => h.name === "check-no-any.mjs")).toBe(false);
    }
  });

  it("does not include no-unwrap for non-rust", () => {
    for (const lang of [
      "typescript",
      "java",
      "go",
      "python",
      "unknown",
    ] as const) {
      const hooks = getLanguageHooks(lang);
      expect(hooks.some((h) => h.name === "check-no-unwrap.mjs")).toBe(false);
    }
  });

  it("returns 2 hooks for typescript (orphan-todo + no-any)", () => {
    expect(getLanguageHooks("typescript")).toHaveLength(2);
  });

  it("returns 2 hooks for rust (orphan-todo + no-unwrap)", () => {
    expect(getLanguageHooks("rust")).toHaveLength(2);
  });

  it("returns 1 hook for java (orphan-todo only)", () => {
    expect(getLanguageHooks("java")).toHaveLength(1);
  });

  it("returns 1 hook for go (orphan-todo only)", () => {
    expect(getLanguageHooks("go")).toHaveLength(1);
  });

  it("returns 1 hook for python (orphan-todo only)", () => {
    expect(getLanguageHooks("python")).toHaveLength(1);
  });

  it("all hooks have valid shebang", () => {
    for (const lang of ["typescript", "rust"] as const) {
      const hooks = getLanguageHooks(lang);
      for (const hook of hooks) {
        expect(hook.body).toMatch(/^#!/);
      }
    }
  });
});
