import { describe, it, expect } from "vitest";
import {
  buildRenderContext,
  templateToMaterialized,
  isAllowlisted,
  isConfigGated,
  normalizeLines,
  computeDiff,
} from "../../scripts/check-self-dogfood.mjs";

// ─── buildRenderContext ───────────────────────────────────────────────────────

describe("buildRenderContext", () => {
  it("reads testCommand from package.json (npm run test)", () => {
    const cfg = {
      governanceLevel: "L2",
      tools: ["claude"],
      features: {},
    };
    const ctx = buildRenderContext(cfg);
    // arbiter's package.json has a 'test' script → should produce 'npm run test'
    expect(ctx.testCommand).toBe("npm run test");
  });

  it("reads lintCommand from package.json (npm run lint)", () => {
    const cfg = {
      governanceLevel: "L2",
      tools: ["claude"],
      features: {},
    };
    const ctx = buildRenderContext(cfg);
    expect(ctx.lintCommand).toBe("npm run lint");
  });

  it("sets enableEvidenceHarness=false when feature flag is false", () => {
    const cfg = {
      features: { evidenceHarness: false },
    };
    const ctx = buildRenderContext(cfg);
    expect(ctx.enableEvidenceHarness).toBe(false);
  });

  it("sets enableEvidenceHarness=true when feature flag is true", () => {
    const cfg = {
      features: { evidenceHarness: true },
    };
    const ctx = buildRenderContext(cfg);
    expect(ctx.enableEvidenceHarness).toBe(true);
  });

  it("defaults to L2 governance level", () => {
    const cfg = {};
    const ctx = buildRenderContext(cfg);
    expect(ctx.governanceLevel).toBe("L2");
  });

  it("passes through tools array from config", () => {
    const cfg = { tools: ["claude", "codex"] };
    const ctx = buildRenderContext(cfg);
    expect(ctx.tools).toEqual(["claude", "codex"]);
  });
});

// ─── templateToMaterialized ───────────────────────────────────────────────────

describe("templateToMaterialized", () => {
  it("strips .ejs extension and maps to .claude/", () => {
    const result = templateToMaterialized(
      "/repo/src/templates/claude/hooks/lib.mjs.ejs",
    );
    expect(result).toMatch(/\.claude\/hooks\/lib\.mjs$/);
    expect(result).not.toContain(".ejs");
  });

  it("handles nested paths", () => {
    const result = templateToMaterialized(
      "/repo/src/templates/claude/skills/tdd/SKILL.md.ejs",
    );
    expect(result).toMatch(/\.claude\/skills\/tdd\/SKILL\.md$/);
  });

  it("handles root-level templates", () => {
    const result = templateToMaterialized(
      "/repo/src/templates/claude/CLAUDE.md.ejs",
    );
    expect(result).toMatch(/\.claude\/CLAUDE\.md$/);
  });
});

// ─── isAllowlisted ────────────────────────────────────────────────────────────

describe("isAllowlisted", () => {
  it("allowlists lines with LucaDominici/arbiter", () => {
    expect(isAllowlisted("githubOwner: 'LucaDominici/arbiter'")).toBe(true);
  });

  it("allowlists lines with absolute paths", () => {
    expect(isAllowlisted('command: "/usr/bin/node"')).toBe(true);
    expect(isAllowlisted("cwd: /home/user/project")).toBe(true);
  });

  it("does not allowlist normal content lines", () => {
    expect(isAllowlisted("node scripts/check-all.mjs")).toBe(false);
    expect(isAllowlisted("## Invariants")).toBe(false);
    expect(isAllowlisted('import { join } from "node:path";')).toBe(false);
  });
});

// ─── isConfigGated ────────────────────────────────────────────────────────────

describe("isConfigGated", () => {
  const templatesDir = "/repo/src/templates/claude";

  it("gates guard-done-evidence.mjs when enableEvidenceHarness is false", () => {
    const ctx = { enableEvidenceHarness: false };
    const path = `${templatesDir}/hooks/guard-done-evidence.mjs.ejs`;
    expect(isConfigGated(path, ctx)).toBe(true);
  });

  it("does not gate guard-done-evidence.mjs when enableEvidenceHarness is true", () => {
    const ctx = { enableEvidenceHarness: true };
    const path = `${templatesDir}/hooks/guard-done-evidence.mjs.ejs`;
    expect(isConfigGated(path, ctx)).toBe(false);
  });

  it("does not gate other hooks regardless of config", () => {
    const ctx = { enableEvidenceHarness: false };
    const path = `${templatesDir}/hooks/lib.mjs.ejs`;
    expect(isConfigGated(path, ctx)).toBe(false);
  });
});

// ─── normalizeLines ───────────────────────────────────────────────────────────

describe("normalizeLines", () => {
  it("drops blank lines", async () => {
    const result = await normalizeLines("line1\n\n\nline2\n", "/fake/test.md");
    expect(result).not.toContain("");
  });

  it("trims trailing whitespace", async () => {
    const result = await normalizeLines(
      "  hello world  \n  foo  \n",
      "/fake/test.md",
    );
    for (const line of result) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("filters allowlisted lines", async () => {
    const content =
      "normal line\nLucaDominici/arbiter specific\nanother line\n";
    const result = await normalizeLines(content, "/fake/test.md");
    expect(result).not.toContain("LucaDominici/arbiter specific");
    expect(result).toContain("normal line");
  });

  it("normalizes markdown table padding via Prettier", async () => {
    const loose = `| x | y |
|---|---|
| hello | world |
`;
    const tight = `| x     | y     |
| ----- | ----- |
| hello | world |
`;
    const r1 = await normalizeLines(loose, "/fake/test.md");
    const r2 = await normalizeLines(tight, "/fake/test.md");
    // Both should produce same normalized output
    expect(r1).toEqual(r2);
  });
});

// ─── computeDiff ─────────────────────────────────────────────────────────────

describe("computeDiff", () => {
  it("returns null when expected and actual are equal", () => {
    const lines = ["line1", "line2", "line3"];
    expect(computeDiff(lines, [...lines])).toBeNull();
  });

  it("returns added lines when actual has extra content", () => {
    const expected = ["line1", "line2"];
    const actual = ["line1", "line2", "line3-new"];
    const diff = computeDiff(expected, actual);
    expect(diff).not.toBeNull();
    expect(diff?.added).toContain("line3-new");
    expect(diff?.removed).toHaveLength(0);
  });

  it("returns removed lines when expected has content missing from actual", () => {
    const expected = ["line1", "line2", "line3-old"];
    const actual = ["line1", "line2"];
    const diff = computeDiff(expected, actual);
    expect(diff).not.toBeNull();
    expect(diff?.removed).toContain("line3-old");
    expect(diff?.added).toHaveLength(0);
  });

  it("returns both added and removed on mixed drift", () => {
    const expected = ["a", "b", "c"];
    const actual = ["a", "b", "d"];
    const diff = computeDiff(expected, actual);
    expect(diff?.removed).toContain("c");
    expect(diff?.added).toContain("d");
  });

  it("returns null for empty arrays", () => {
    expect(computeDiff([], [])).toBeNull();
  });

  it("DETECTS duplicate-line drift (regression: BLOCKER-8, INV-45)", () => {
    // Set-based diff would consider these equal (same UNIQUE lines).
    // Position-aware diff must flag the extra "x" as added drift.
    const expected = ["x", "y"];
    const actual = ["x", "y", "x"];
    const diff = computeDiff(expected, actual);
    expect(diff).not.toBeNull();
    expect(diff?.added).toEqual(["x"]);
    expect(diff?.removed).toHaveLength(0);
  });

  it("DETECTS missing duplicate-line drift (mirror case)", () => {
    const expected = ["x", "y", "x"];
    const actual = ["x", "y"];
    const diff = computeDiff(expected, actual);
    expect(diff).not.toBeNull();
    expect(diff?.removed).toEqual(["x"]);
    expect(diff?.added).toHaveLength(0);
  });

  it("preserves multiset semantics on multi-line counts", () => {
    // expected has 3 of "a", actual has 1 → 2 should be removed
    const expected = ["a", "a", "a", "b"];
    const actual = ["a", "b"];
    const diff = computeDiff(expected, actual);
    expect(diff?.removed).toEqual(["a", "a"]);
    expect(diff?.added).toHaveLength(0);
  });
});
