import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("db_fixture.rs.ejs — F10 testcontainers-rs scaffold (#369)", () => {
  function render() {
    const data = makeConfig("/tmp/test", {
      language: "rust",
      buildTool: "cargo",
      hasDatabase: true,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    return renderTemplate("integration-testing/db_fixture.rs.ejs", data);
  }

  it("uses testcontainers::clients::Cli", () => {
    expect(render()).toContain("testcontainers::clients::Cli");
  });

  it("uses GenericImage with postgres:16-alpine", () => {
    const content = render();
    expect(content).toContain("GenericImage");
    expect(content).toContain("postgres");
    expect(content).toContain("16-alpine");
  });

  it("waits for stderr ready message", () => {
    expect(render()).toContain(
      "database system is ready to accept connections",
    );
  });

  it("uses OnceLock for static client", () => {
    expect(render()).toContain("OnceLock");
  });

  it("does not panic on missing DATABASE_URL (#369)", () => {
    expect(render()).not.toContain('panic!("DATABASE_URL"');
  });
});
