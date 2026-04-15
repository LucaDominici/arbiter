import { describe, it, expect } from "vitest";
import { formatText, formatJson } from "../../src/compatibility/report.js";
import type { VerifyReport } from "../../src/compatibility/schema.js";

const passed: VerifyReport = {
  dir: "/projects/my-app",
  stack: "typescript",
  probes: [
    {
      tool: "node",
      status: "passed",
      version: { major: 20, minor: 11, patch: 1 },
    },
    {
      tool: "npm",
      status: "passed",
      version: { major: 10, minor: 2, patch: 4 },
    },
  ],
  hasFailures: false,
};

const mixed: VerifyReport = {
  dir: "/projects/my-app",
  stack: "java",
  probes: [
    {
      tool: "java",
      status: "passed",
      version: { major: 21, minor: 0, patch: 1 },
    },
    { tool: "gradle", status: "skipped", reason: "toolchain-missing" },
    {
      tool: "mvn",
      status: "failed",
      version: { major: 3, minor: 6, patch: 0 },
      reason: "version 3.6 outside >=3.8",
    },
  ],
  hasFailures: true,
};

describe("formatText", () => {
  it("renders all-passed report", () => {
    const out = formatText(passed);
    expect(out).toContain("typescript");
    expect(out).toContain("passed");
    expect(out).toContain("node");
    expect(out).toContain("20.11.1");
  });

  it("renders mixed report with skipped and failed", () => {
    const out = formatText(mixed);
    expect(out).toContain("skipped");
    expect(out).toContain("failed");
    expect(out).toContain("version 3.6 outside >=3.8");
  });

  it("includes overall status line", () => {
    expect(formatText(passed)).toContain("OK");
    expect(formatText(mixed)).toContain("FAIL");
  });
});

describe("formatJson", () => {
  it("serializes the full report", () => {
    const obj = JSON.parse(formatJson(passed)) as VerifyReport;
    expect(obj.stack).toBe("typescript");
    expect(obj.hasFailures).toBe(false);
    expect(obj.probes).toHaveLength(2);
  });

  it("includes failure info", () => {
    const obj = JSON.parse(formatJson(mixed)) as VerifyReport;
    expect(obj.hasFailures).toBe(true);
    const mvn = obj.probes.find((p) => p.tool === "mvn");
    expect(mvn?.status).toBe("failed");
    expect(mvn?.reason).toContain("outside");
  });
});
