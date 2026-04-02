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

  it("includes check-no-unchecked-err hook for go", () => {
    const hooks = getLanguageHooks("go");
    const noUnchecked = hooks.find(
      (h) => h.name === "check-no-unchecked-err.mjs",
    );
    expect(noUnchecked).toBeDefined();
    expect(noUnchecked!.body).toContain(".go");
    expect(noUnchecked!.description).toMatch(/error/i);
  });

  it("includes check-no-bare-except hook for python", () => {
    const hooks = getLanguageHooks("python");
    const noBareExcept = hooks.find(
      (h) => h.name === "check-no-bare-except.mjs",
    );
    expect(noBareExcept).toBeDefined();
    expect(noBareExcept!.body).toContain(".py");
    expect(noBareExcept!.description).toMatch(/except/i);
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

  it("does not include check-no-unchecked-err for non-go", () => {
    for (const lang of [
      "typescript",
      "rust",
      "java",
      "python",
      "unknown",
    ] as const) {
      const hooks = getLanguageHooks(lang);
      expect(hooks.some((h) => h.name === "check-no-unchecked-err.mjs")).toBe(
        false,
      );
    }
  });

  it("does not include check-no-bare-except for non-python", () => {
    for (const lang of [
      "typescript",
      "rust",
      "java",
      "go",
      "unknown",
    ] as const) {
      const hooks = getLanguageHooks(lang);
      expect(hooks.some((h) => h.name === "check-no-bare-except.mjs")).toBe(
        false,
      );
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

  it("returns 2 hooks for go (orphan-todo + no-unchecked-err)", () => {
    expect(getLanguageHooks("go")).toHaveLength(2);
  });

  it("returns 2 hooks for python (orphan-todo + no-bare-except)", () => {
    expect(getLanguageHooks("python")).toHaveLength(2);
  });

  it("all hooks have valid shebang", () => {
    for (const lang of ["typescript", "rust", "go", "python"] as const) {
      const hooks = getLanguageHooks(lang);
      for (const hook of hooks) {
        expect(hook.body).toMatch(/^#!/);
      }
    }
  });
});
