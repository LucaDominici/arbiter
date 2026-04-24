import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as runCliModule from "../../src/utils/run-cli.js";

vi.mock("../../src/utils/run-cli.js", () => ({
  runCli: vi.fn(),
  runCliJson: vi.fn(),
}));

const mockRunCli = vi.mocked(runCliModule.runCli);
const mockRunCliJson = vi.mocked(runCliModule.runCliJson);

describe("createProjectBoard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures field-create failures in warnings[] while keeping created: true", async () => {
    const { createProjectBoard } =
      await import("../../src/github/project-board.js");
    mockRunCliJson.mockReturnValue({
      number: 42,
      url: "https://github.com/orgs/o/projects/42",
    });
    mockRunCli.mockImplementation(() => {
      throw new Error("field-create: insufficient scope");
    });

    const result = createProjectBoard("owner", "repo");

    expect(result.created).toBe(true);
    expect(result.error).toBeNull();
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(
      result.warnings.some((w) =>
        w.includes("field-create: insufficient scope"),
      ),
    ).toBe(true);
  });

  it("returns empty warnings when both field-creates succeed", async () => {
    const { createProjectBoard } =
      await import("../../src/github/project-board.js");
    mockRunCliJson.mockReturnValue({
      number: 1,
      url: "https://github.com/orgs/o/projects/1",
    });
    mockRunCli.mockReturnValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = createProjectBoard("owner", "repo");

    expect(result.created).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns created: false and error when project create fails", async () => {
    const { createProjectBoard } =
      await import("../../src/github/project-board.js");
    mockRunCliJson.mockImplementation(() => {
      throw new Error("HTTP 403: Forbidden");
    });

    const result = createProjectBoard("owner", "repo");

    expect(result.created).toBe(false);
    expect(result.error).toContain("HTTP 403: Forbidden");
  });
});
