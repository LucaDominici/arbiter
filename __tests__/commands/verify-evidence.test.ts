import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSummarySha } from "../../src/risk/sha-check.js";
import { runVerifyEvidence } from "../../src/commands/verify.js";

function makeSummary(overrides: Record<string, unknown> = {}): {
  body: Record<string, unknown>;
  serialised: string;
} {
  const body: Record<string, unknown> = {
    stack: "typescript",
    files: ["src/api/users.ts", "docs/intro.md"],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
  const sha = computeSummarySha(body);
  const finalBody = { ...body, sha };
  return { body: finalBody, serialised: JSON.stringify(finalBody, null, 2) };
}

describe("runVerifyEvidence (#238)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-evidence-"));
    mkdirSync(join(dir, ".evidence"), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns ok status when SUMMARY.json sha + freshness pass", () => {
    const { serialised } = makeSummary();
    writeFileSync(join(dir, ".evidence", "SUMMARY.json"), serialised);
    const result = runVerifyEvidence({ dir });
    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("ok");
  });

  it("surfaces aggregate riskLevel computed from files[]", () => {
    // src/auth/login.ts → R1, docs/intro.md → R4 → highest = R1
    const { serialised } = makeSummary({
      files: ["src/auth/login.ts", "docs/intro.md"],
    });
    writeFileSync(join(dir, ".evidence", "SUMMARY.json"), serialised);
    const result = runVerifyEvidence({ dir });
    expect(result.exitCode).toBe(0);
    expect(result.riskLevel).toBe("R1");
  });

  it("returns error+exit 2 when SUMMARY.json sha is corrupted", () => {
    const { body } = makeSummary();
    const tampered = { ...body, files: ["mutated"] }; // sha now stale
    writeFileSync(
      join(dir, ".evidence", "SUMMARY.json"),
      JSON.stringify(tampered, null, 2),
    );
    const result = runVerifyEvidence({ dir });
    expect(result.exitCode).toBe(2);
    expect(result.status).toBe("error");
  });

  it("blocks (exit 2) when stale evidence covers an R2 (medium-risk) change set", () => {
    // Default fixture files include src/api/users.ts → R2
    const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { serialised } = makeSummary({ timestamp: oldTs });
    writeFileSync(join(dir, ".evidence", "SUMMARY.json"), serialised);
    const result = runVerifyEvidence({ dir });
    expect(result.status).toBe("error");
    expect(result.exitCode).toBe(2);
    expect(result.riskLevel).toBe("R2");
    expect(result.reason).toMatch(/high-risk/);
  });

  it("advises (exit 1) when stale evidence covers only low-risk files (R4)", () => {
    const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { serialised } = makeSummary({
      timestamp: oldTs,
      files: ["docs/intro.md", "README.md"],
    });
    writeFileSync(join(dir, ".evidence", "SUMMARY.json"), serialised);
    const result = runVerifyEvidence({ dir });
    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(1);
    expect(result.riskLevel).toBe("R4");
  });

  it("advises (exit 1) and refuses to fail open on UNCLASSIFIED files", () => {
    const { serialised } = makeSummary({
      files: ["random/file.unknown-ext"],
    });
    writeFileSync(join(dir, ".evidence", "SUMMARY.json"), serialised);
    const result = runVerifyEvidence({ dir });
    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(1);
    expect(result.riskLevel).toBe("R-unknown");
    expect(result.reason).toMatch(/manual review/);
  });

  it("falls back to legacy warning-only stale when files[] is absent", () => {
    // No files[] = cannot risk-gate, preserve advisory behaviour.
    const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const body: Record<string, unknown> = {
      stack: "typescript",
      timestamp: oldTs,
    };
    const { serialised } = makeSummary(body);
    writeFileSync(join(dir, ".evidence", "SUMMARY.json"), serialised);
    // Wipe files key (makeSummary preserves it from defaults — override fully)
    const parsed = JSON.parse(serialised) as Record<string, unknown>;
    delete parsed["files"];
    delete parsed["sha"];
    const sha = computeSummarySha(parsed);
    writeFileSync(
      join(dir, ".evidence", "SUMMARY.json"),
      JSON.stringify({ ...parsed, sha }, null, 2),
    );
    const result = runVerifyEvidence({ dir });
    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(1);
    expect(result.riskLevel).toBeUndefined();
  });

  it("returns error when SUMMARY.json is missing", () => {
    const result = runVerifyEvidence({ dir });
    expect(result.exitCode).toBe(1);
    expect(result.status).toBe("error");
  });

  it("respects E2E_RISK_SKIP env and writes skip-log entry", () => {
    const { serialised } = makeSummary();
    writeFileSync(join(dir, ".evidence", "SUMMARY.json"), serialised);
    const orig = process.env["E2E_RISK_SKIP"];
    process.env["E2E_RISK_SKIP"] = "flaky-on-ci";
    try {
      const result = runVerifyEvidence({ dir });
      expect(result.skipped).toBe(true);
      expect(result.exitCode).toBe(0);
      const skipLog = join(dir, ".evidence", "skip-log.jsonl");
      expect(existsSync(skipLog)).toBe(true);
      const line =
        readFileSync(skipLog, "utf-8").trim().split("\n").pop() ?? "";
      const parsed = JSON.parse(line);
      expect(parsed.reason).toBe("flaky-on-ci");
      expect(typeof parsed.ts).toBe("string");
    } finally {
      if (orig === undefined) {
        delete process.env["E2E_RISK_SKIP"];
      } else {
        process.env["E2E_RISK_SKIP"] = orig;
      }
    }
  });
});
