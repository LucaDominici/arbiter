import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

const data = makeConfig("/tmp/test") as unknown as Record<string, unknown>;

describe("commitlint.config.js.ejs (#202)", () => {
  it("renders without EJS leaks", () => {
    const out = renderTemplate("root/commitlint.config.js.ejs", data);
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("contains @commitlint/config-conventional", () => {
    const out = renderTemplate("root/commitlint.config.js.ejs", data);
    expect(out).toContain("@commitlint/config-conventional");
  });

  it("is valid JavaScript (contains module.exports)", () => {
    const out = renderTemplate("root/commitlint.config.js.ejs", data);
    expect(out).toContain("module.exports");
  });
});
