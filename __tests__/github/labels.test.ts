import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as runCliModule from "../../src/utils/run-cli.js";

vi.mock("../../src/utils/run-cli.js", () => ({
  runCli: vi.fn(),
  runCliJson: vi.fn(),
}));

const mockRunCli = vi.mocked(runCliModule.runCli);
const mockRunCliJson = vi.mocked(runCliModule.runCliJson);

describe("provisionLabels", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces list failure in result.errors with 'list labels failed:' prefix", async () => {
    const { provisionLabels } = await import("../../src/github/labels.js");
    mockRunCliJson.mockImplementation(() => {
      throw new Error("HTTP 401: Bad credentials");
    });
    // label edit/create succeed so they don't mask the list error
    mockRunCli.mockReturnValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = provisionLabels("owner", "repo");

    expect(result.errors.some((e) => e.startsWith("list labels failed:"))).toBe(
      true,
    );
    expect(result.errors[0]).toContain("HTTP 401: Bad credentials");
  });

  it("does not populate errors when label list succeeds", async () => {
    const { provisionLabels } = await import("../../src/github/labels.js");
    mockRunCliJson.mockReturnValue([]);
    mockRunCli.mockReturnValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = provisionLabels("owner", "repo");

    expect(result.errors).toHaveLength(0);
  });
});
