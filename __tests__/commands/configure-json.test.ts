import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runConfigure } from "../../src/commands/configure.js";

vi.mock("../../src/utils/config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock("../../src/config/schema.js", () => ({
  validateConfig: vi.fn(),
}));

import { loadConfig } from "../../src/utils/config.js";
import { validateConfig } from "../../src/config/schema.js";

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockValidateConfig = validateConfig as ReturnType<typeof vi.fn>;

const BASE_CONFIG = {
  governanceLevel: "L1",
  tools: ["claude"],
  useGitHub: false,
  features: {
    debtGates: false,
    suppressions: false,
    securityScanning: false,
    mutationTesting: false,
    contractTesting: false,
    evidenceHarness: false,
  },
  thresholds: {
    lineCoverage: 80,
    branchCoverage: 75,
    mutationScore: 60,
    cyclomaticComplexity: 10,
    methodLength: 30,
    maxParams: 4,
  },
  version: 2 as const,
};

describe("configure --json", () => {
  let written: string;

  beforeEach(() => {
    written = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits JSON envelope on success", () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG });
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG });

    runConfigure({ sets: ["useGitHub=true"], json: true });

    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.command).toBe("configure");
    expect(parsed.version).toBe("1");
    expect(parsed.status).toBe("ok");
    expect(parsed.data).toMatchObject({ updated: ["useGitHub=true"] });
  });

  it("emits JSON error when no config found", () => {
    mockLoadConfig.mockReturnValue(null);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    expect(() =>
      runConfigure({ sets: ["useGitHub=true"], json: true }),
    ).toThrow("process.exit");

    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.status).toBe("error");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does not emit JSON in human mode", () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG });
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    runConfigure({ sets: ["useGitHub=false"], json: false });

    expect(written).toBe("");
    consoleSpy.mockRestore();
  });

  it("emits JSON error envelope on empty --set with --json (BLOCKER-9)", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    expect(() => runConfigure({ sets: [], json: true })).toThrow(
      "process.exit",
    );

    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.command).toBe("configure");
    expect(parsed.status).toBe("error");
    expect(parsed.errors).toEqual([
      "--set is required (non-interactive usage)",
    ]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
