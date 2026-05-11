import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runPluginAdd,
  runPluginRemove,
  runPluginList,
} from "../../src/commands/plugin.js";

vi.mock("../../src/utils/config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));
vi.mock("../../src/utils/plugin-loader.js", () => ({
  loadPlugin: vi.fn().mockResolvedValue(undefined),
}));

import { loadConfig } from "../../src/utils/config.js";

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;

const BASE_CONFIG = {
  governanceLevel: "L1" as const,
  tools: ["claude"],
  useGitHub: false,
  plugins: [],
  features: {
    debtGates: false,
    suppressions: false,
    securityScanning: false,
    mutationTesting: false,
    contractTesting: false,
    evidenceHarness: false,
  },
  thresholds: {},
  version: 2 as const,
};

describe("plugin --json", () => {
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

  it("plugin add emits JSON envelope on success", async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG });

    await runPluginAdd({ pkg: "my-plugin", json: true });

    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.command).toBe("plugin-add");
    expect(parsed.status).toBe("ok");
    expect((parsed.data as Record<string, unknown>).pkg).toBe("my-plugin");
  });

  it("plugin remove emits JSON envelope on success", () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG, plugins: ["my-plugin"] });

    runPluginRemove({ pkg: "my-plugin", json: true });

    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.command).toBe("plugin-remove");
    expect(parsed.status).toBe("ok");
    expect((parsed.data as Record<string, unknown>).pkg).toBe("my-plugin");
  });

  it("plugin list emits JSON envelope with plugin statuses", async () => {
    mockLoadConfig.mockReturnValue({
      ...BASE_CONFIG,
      plugins: ["my-plugin"],
    });

    await runPluginList({ json: true });

    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.command).toBe("plugin-list");
    expect(parsed.status).toBe("ok");
    const data = parsed.data as Record<string, unknown>;
    const plugins = data.plugins as Array<Record<string, unknown>>;
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins[0]).toMatchObject({ pkg: "my-plugin", status: "resolved" });
  });

  it("plugin add emits JSON error when no config", async () => {
    mockLoadConfig.mockReturnValue(null);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      runPluginAdd({ pkg: "my-plugin", json: true }),
    ).rejects.toThrow("process.exit");

    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.status).toBe("error");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
