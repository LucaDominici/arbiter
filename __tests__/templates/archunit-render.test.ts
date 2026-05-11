import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

function renderArch(architectureStyle: string) {
  const data = makeConfig("/tmp/test", {
    language: "java",
    buildTool: "gradle",
    architectureStyle,
    basePackage: "com.example.app",
  }) as unknown as Record<string, unknown>;
  return renderTemplate("archunit/ArchitectureTest.java.ejs", data);
}

describe("ArchitectureTest.java.ejs — F11 style rules + fail-loud else (#370)", () => {
  it("hexagonal: contains domain_must_not_depend_on_infrastructure @ArchTest", () => {
    const content = renderArch("hexagonal");
    expect(content).toContain("domain_must_not_depend_on_infrastructure");
    expect(content).toContain("@ArchTest");
  });

  it("hexagonal: contains adapters_must_not_depend_on_each_other", () => {
    expect(renderArch("hexagonal")).toContain(
      "adapters_must_not_depend_on_each_other",
    );
  });

  it("layered: contains repositories_must_not_depend_on_services @ArchTest", () => {
    const content = renderArch("layered");
    expect(content).toContain("repositories_must_not_depend_on_services");
    expect(content).toContain("@ArchTest");
  });

  it("layered: contains services_must_not_depend_on_controllers", () => {
    expect(renderArch("layered")).toContain(
      "services_must_not_depend_on_controllers",
    );
  });

  it("modular-monolith: contains no_cross_module_internal_access @ArchTest", () => {
    const content = renderArch("modular-monolith");
    expect(content).toContain("no_cross_module_internal_access");
    expect(content).toContain("@ArchTest");
  });

  it("unknown style: contains Assertions.fail (fail-loud, not silent comment) (#370)", () => {
    const content = renderArch("unknown-style");
    expect(content).toContain("Assertions.fail");
  });

  it("unknown style: does not emit any @ArchTest rules", () => {
    expect(renderArch("unknown-style")).not.toContain("@ArchTest");
  });
});
