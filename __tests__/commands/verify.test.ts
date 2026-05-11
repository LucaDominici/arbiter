import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as probe from "../../src/compatibility/probe.js";
import * as report from "../../src/compatibility/report.js";

type VerifyReport = ReturnType<typeof probe.runProbes>;

function makeReport(overrides: Partial<VerifyReport> = {}): VerifyReport {
  return {
    dir: "/fake",
    stack: "typescript",
    probes: [],
    hasFailures: false,
    hasWarnings: false,
    ...overrides,
  };
}

describe("runVerify (#174)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let probesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    probesSpy = vi.spyOn(probe, "runProbes");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes text output and does not call exit when no failures", async () => {
    probesSpy.mockReturnValue(makeReport({ hasFailures: false }));
    vi.spyOn(report, "formatText").mockReturnValue("all good");

    const { runVerify } = await import("../../src/commands/verify.js");
    runVerify({});

    expect(stdoutSpy).toHaveBeenCalledWith("all good\n");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("calls process.exit(1) when report has failures", async () => {
    probesSpy.mockReturnValue(makeReport({ hasFailures: true }));
    vi.spyOn(report, "formatText").mockReturnValue("failed");

    const { runVerify } = await import("../../src/commands/verify.js");
    runVerify({});

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("uses formatJson when opts.json is true", async () => {
    probesSpy.mockReturnValue(makeReport());
    const jsonSpy = vi
      .spyOn(report, "formatJson")
      .mockReturnValue('{"ok":true}');

    const { runVerify } = await import("../../src/commands/verify.js");
    runVerify({ json: true });

    expect(jsonSpy).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith('{"ok":true}\n');
  });

  it("calls process.exit(1) when json mode has failures", async () => {
    probesSpy.mockReturnValue(makeReport({ hasFailures: true }));
    vi.spyOn(report, "formatJson").mockReturnValue('{"err":true}');

    const { runVerify } = await import("../../src/commands/verify.js");
    runVerify({ json: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("resolves dir relative to cwd when opts.dir is provided", async () => {
    probesSpy.mockReturnValue(makeReport());
    vi.spyOn(report, "formatText").mockReturnValue("");

    const { runVerify } = await import("../../src/commands/verify.js");
    runVerify({ dir: "some/path" });

    expect(probesSpy).toHaveBeenCalledWith(
      expect.stringContaining("some/path"),
    );
  });
});
