import { describe, it, expect } from "vitest";
import { computeSummarySha, verifySummarySha } from "../../src/risk/sha-check.js";

describe("computeSummarySha (#238)", () => {
  it("returns the same hash for structurally identical inputs", () => {
    const a = { files: ["a", "b"], stack: "typescript", timestamp: "2026-01-01T00:00:00Z" };
    const b = { stack: "typescript", files: ["a", "b"], timestamp: "2026-01-01T00:00:00Z" };
    expect(computeSummarySha(a)).toBe(computeSummarySha(b));
  });

  it("returns different hashes when content changes", () => {
    const a = { files: ["a"], stack: "typescript", timestamp: "2026-01-01T00:00:00Z" };
    const b = { files: ["b"], stack: "typescript", timestamp: "2026-01-01T00:00:00Z" };
    expect(computeSummarySha(a)).not.toBe(computeSummarySha(b));
  });

  it("is a 64-char hex SHA-256 digest", () => {
    const sha = computeSummarySha({ x: 1 });
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifySummarySha (#238)", () => {
  it("returns ok=true when stored SHA matches recomputed body", () => {
    const body = { stack: "typescript", files: ["x"], timestamp: "2026-01-01T00:00:00Z" };
    const sha = computeSummarySha(body);
    const result = verifySummarySha({ ...body, sha });
    expect(result.ok).toBe(true);
  });

  it("returns ok=false when stored SHA is wrong", () => {
    const body = { stack: "typescript", files: ["x"], timestamp: "2026-01-01T00:00:00Z" };
    const result = verifySummarySha({ ...body, sha: "0".repeat(64) });
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when sha field is missing", () => {
    const body = { stack: "typescript", files: ["x"], timestamp: "2026-01-01T00:00:00Z" };
    const result = verifySummarySha(body as unknown as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });
});
