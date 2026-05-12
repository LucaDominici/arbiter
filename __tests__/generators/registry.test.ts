import { describe, it, expect } from "vitest";
import { buildRegistry } from "../../src/generators/registry.js";
import { makeConfig } from "../helpers.js";

describe("buildRegistry", () => {
  it("check-all is always enabled regardless of useGitHub", () => {
    const withGitHub = buildRegistry(makeConfig("/tmp", { useGitHub: true }));
    const withoutGitHub = buildRegistry(
      makeConfig("/tmp", { useGitHub: false }),
    );

    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key);

    expect(find(withGitHub, "check-all")?.enabled).toBe(true);
    expect(find(withoutGitHub, "check-all")?.enabled).toBe(true);
  });

  it("github generator is only enabled when useGitHub is true", () => {
    const withGitHub = buildRegistry(makeConfig("/tmp", { useGitHub: true }));
    const withoutGitHub = buildRegistry(
      makeConfig("/tmp", { useGitHub: false }),
    );

    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key);

    expect(find(withGitHub, "github")?.enabled).toBe(true);
    expect(find(withoutGitHub, "github")?.enabled).toBe(false);
  });

  it("suppressions is always enabled regardless of enableSuppressions (#242)", () => {
    const withSuppression = buildRegistry(
      makeConfig("/tmp", { enableSuppressions: true }),
    );
    const withoutSuppression = buildRegistry(
      makeConfig("/tmp", { enableSuppressions: false }),
    );

    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key);

    expect(find(withSuppression, "suppressions")?.enabled).toBe(true);
    expect(find(withoutSuppression, "suppressions")?.enabled).toBe(true);
  });
});
