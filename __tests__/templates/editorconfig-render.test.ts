import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import type { Language } from "../../src/wizard/types.js";

function cfg(language: Language) {
  return makeConfig("/tmp/test", { language }) as unknown as Record<
    string,
    unknown
  >;
}

describe("editorconfig.ejs (#205)", () => {
  it("TypeScript render: contains TS section with indent_size = 2", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("typescript"));
    expect(out).toContain("[*.{ts,tsx,js,jsx}]");
    expect(out).toContain("indent_size = 2");
  });

  it("Go render: contains Go section with indent_style = tab", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("go"));
    expect(out).toContain("[*.go]");
    expect(out).toContain("indent_style = tab");
  });

  it("Java render: contains Java section with indent_size = 4", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("java"));
    expect(out).toContain("[*.{java,gradle,groovy}]");
    expect(out).toContain("indent_size = 4");
  });

  it("Python render: contains Python section with indent_size = 4 and no Go section", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("python"));
    expect(out).toContain("[*.py]");
    expect(out).toContain("indent_size = 4");
    expect(out).not.toContain("[*.go]");
  });

  it("TypeScript render: no EJS leaks", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("typescript"));
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("Go render: no EJS leaks", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("go"));
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("Java render: no EJS leaks", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("java"));
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("Python render: no EJS leaks", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("python"));
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("Rust render: contains Rust section with indent_size = 4", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("rust"));
    expect(out).toContain("[*.{rs,toml}]");
    expect(out).toContain("indent_size = 4");
  });

  it("TypeScript render: does not contain Go or Python sections", () => {
    const out = renderTemplate("root/editorconfig.ejs", cfg("typescript"));
    expect(out).not.toContain("[*.go]");
    expect(out).not.toContain("[*.py]");
  });
});
