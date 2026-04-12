import { describe, it, expect } from "vitest";
import { fetchGithubData } from "../../src/generators/obsidian-vault-github-fetch.js";

describe("fetchGithubData", () => {
  it("returns unavailable when owner is null", () => {
    const result = fetchGithubData(null, "repo");
    expect(result.available).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.labels).toEqual([]);
  });

  it("returns unavailable when repo is null", () => {
    const result = fetchGithubData("owner", null);
    expect(result.available).toBe(false);
  });

  it("returns unavailable when gh call fails (nonexistent repo)", () => {
    const result = fetchGithubData(
      "arbiter-nonexistent-owner-x9",
      "nonexistent-repo-y9",
    );
    expect(result.available).toBe(false);
  });
});
