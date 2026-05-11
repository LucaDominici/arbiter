import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("PIT mutation templates — F12 failWhenNoMutations (#371)", () => {
  it("pitest.gradle.ejs contains failWhenNoMutations = true", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      basePackage: "com.example.app",
      mutationThreshold: 80,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("mutation/pitest.gradle.ejs", data);
    expect(content).toContain("failWhenNoMutations = true");
  });

  it("pitest-maven-setup.md.ejs contains <failWhenNoMutations>true</failWhenNoMutations>", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "maven",
      basePackage: "com.example.app",
      mutationThreshold: 80,
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("mutation/pitest-maven-setup.md.ejs", data);
    expect(content).toContain(
      "<failWhenNoMutations>true</failWhenNoMutations>",
    );
  });
});
