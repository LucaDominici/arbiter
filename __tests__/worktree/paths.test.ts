import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  sanitizeTaskId,
  sanitizeSlug,
  branchNameFor,
  worktreeDirectoryName,
  resolveWorktreeBase,
  worktreePathFor,
} from "../../src/worktree/paths.js";

describe("sanitizeTaskId", () => {
  it("preserves an id that already starts with #", () => {
    expect(sanitizeTaskId("#85")).toBe("#85");
  });

  it("prepends # when id is a bare number", () => {
    expect(sanitizeTaskId("85")).toBe("#85");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeTaskId("  #42  ")).toBe("#42");
  });

  it("rejects slashes in the id", () => {
    expect(() => sanitizeTaskId("12/3")).toThrow(/invalid/i);
  });
});

describe("sanitizeSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(sanitizeSlug("Arbiter Verify")).toBe("arbiter-verify");
  });

  it("strips leading and trailing hyphens", () => {
    expect(sanitizeSlug("  !Arbiter!  ")).toBe("arbiter");
  });

  it("collapses multiple non-alphanumeric chars into one hyphen", () => {
    expect(sanitizeSlug("foo---bar")).toBe("foo-bar");
  });

  it("truncates at 40 characters", () => {
    const long = "a".repeat(50);
    expect(sanitizeSlug(long)).toHaveLength(40);
  });

  it("handles special characters", () => {
    expect(sanitizeSlug("Arbiter Verify!")).toBe("arbiter-verify");
  });
});

describe("branchNameFor", () => {
  it("returns task/<id> when no slug is given", () => {
    expect(branchNameFor("#97")).toBe("task/#97");
  });

  it("returns task/<id>-<slug> when slug is given", () => {
    expect(branchNameFor("#97", "my-feature")).toBe("task/#97-my-feature");
  });

  it("auto-sanitizes the task id (no #)", () => {
    expect(branchNameFor("97")).toBe("task/#97");
  });

  it("auto-sanitizes the slug", () => {
    expect(branchNameFor("#97", "My Feature!")).toBe("task/#97-my-feature");
  });
});

describe("worktreeDirectoryName", () => {
  it("returns just the task id when no slug", () => {
    expect(worktreeDirectoryName("#97")).toBe("#97");
  });

  it("appends sanitized slug separated by hyphen", () => {
    expect(worktreeDirectoryName("#97", "my feature")).toBe("#97-my-feature");
  });
});

describe("resolveWorktreeBase", () => {
  it("uses ARBITER_WORKTREES_DIR env override when provided", () => {
    const result = resolveWorktreeBase(
      "/home/luca/repos/arbiter",
      null,
      "/custom/path",
    );
    expect(result).toBe("/custom/path");
  });

  it("uses configBase when provided and no env override", () => {
    const result = resolveWorktreeBase(
      "/home/luca/repos/arbiter",
      "/explicit/base",
    );
    expect(result).toBe("/explicit/base");
  });

  it("falls back to sibling <repoName>.worktrees directory", () => {
    const result = resolveWorktreeBase("/home/luca/repos/arbiter", null);
    expect(result).toBe("/home/luca/repos/arbiter.worktrees");
  });

  it("sibling path works for deeply nested repos", () => {
    const result = resolveWorktreeBase("/a/b/c/myrepo", null);
    expect(result).toBe("/a/b/c/myrepo.worktrees");
  });
});

describe("worktreePathFor", () => {
  it("joins base + directory name", () => {
    expect(worktreePathFor("/base/dir", "#97")).toBe(join("/base/dir", "#97"));
  });

  it("includes slug in the directory name", () => {
    expect(worktreePathFor("/base/dir", "#97", "my-feature")).toBe(
      join("/base/dir", "#97-my-feature"),
    );
  });
});
