import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

const DUMMY_DIR = "/tmp/arbiter-playwright-render-test";

function renderPlaywright(
  template: string,
  overrides: Record<string, unknown> = {},
): string {
  const config = makeConfig(DUMMY_DIR, { language: "python", ...overrides });
  return renderTemplate(template, { ...config, ...overrides });
}

describe("playwright-python templates (#366)", () => {
  describe("conftest.py.ejs", () => {
    it("imports playwright fixtures", () => {
      const content = renderPlaywright("e2e/playwright-python/conftest.py.ejs");
      expect(content).toContain("pytest");
      expect(content).toContain("playwright");
    });

    it("defines browser fixture or uses playwright plugin", () => {
      const content = renderPlaywright("e2e/playwright-python/conftest.py.ejs");
      expect(content).toContain("page");
    });
  });

  describe("test_smoke.py.ejs", () => {
    it("contains a page.goto call", () => {
      const content = renderPlaywright(
        "e2e/playwright-python/test_smoke.py.ejs",
      );
      expect(content).toContain("page.goto");
    });

    it("asserts page title", () => {
      const content = renderPlaywright(
        "e2e/playwright-python/test_smoke.py.ejs",
      );
      expect(content).toContain("title");
    });

    it("uses def test_ naming convention", () => {
      const content = renderPlaywright(
        "e2e/playwright-python/test_smoke.py.ejs",
      );
      expect(content).toContain("def test_");
    });
  });
});
