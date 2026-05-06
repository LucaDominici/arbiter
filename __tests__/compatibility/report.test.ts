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
  hasWarnings: false,
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
  hasWarnings: false,
};

const withWarning: VerifyReport = {
  dir: "/projects/my-app",
  stack: "typescript",
  probes: [
    {
      tool: "node",
      status: "passed",
      version: { major: 20, minor: 11, patch: 1 },
    },
    {
      tool: "hooksPath",
      status: "warning",
      reason:
        ".githooks/pre-commit exists but core.hooksPath is not set to .githooks. " +
        "Run: git config core.hooksPath .githooks (or ./scripts/setup-hooks.sh for non-Node projects).",
    },
  ],
  hasFailures: false,
  hasWarnings: true,
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

describe("formatText — remediation hints", () => {
  it("includes remediation hint for failed version probe", () => {
    const out = formatText(mixed);
    // mvn failed → should include upgrade hint
    expect(out).toMatch(/upgrade.*maven|maven.*upgrade/i);
  });

  it("does not include remediation hint for skipped probes", () => {
    const out = formatText(mixed);
    // gradle skipped → no remediation for gradle in output
    const lines = out.split("\n");
    const gradleLine = lines.findIndex((l) => l.includes("gradle"));
    const nextLine = lines[gradleLine + 1] ?? "";
    expect(nextLine).not.toMatch(/→/);
  });
});

describe("formatText — warning probes", () => {
  it("renders ⚠ prefix on warning probe line", () => {
    const out = formatText(withWarning);
    expect(out).toContain("[warning] ⚠ hooksPath");
  });

  it("renders remediation arrow for warning probe", () => {
    const out = formatText(withWarning);
    expect(out).toContain("→ .githooks/pre-commit exists but core.hooksPath");
  });

  it("renders warning summary line when hasWarnings is true", () => {
    const out = formatText(withWarning);
    expect(out).toContain("⚠ 1 warning(s): run suggested commands above");
  });

  it("does not render warning summary line when hasWarnings is false", () => {
    const out = formatText(passed);
    expect(out).not.toContain("warning(s):");
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
