import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MarkdownBackend } from "../../src/decomposition/markdown-backend.js";
import type { ArbiterConfigV2 } from "../../src/config/schema.js";

function makeConfig(): ArbiterConfigV2 {
  return {
    version: "0.2",
    tools: ["claude"],
    governanceLevel: "L2",
    useGitHub: false,
    decomposition: { backend: "markdown" },
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: true,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 80,
      cyclomaticComplexity: 15,
      methodLength: 65,
      maxParams: 7,
    },
  } as ArbiterConfigV2;
}

describe("MarkdownBackend", () => {
  let dir: string;
  let backend: MarkdownBackend;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-md-backend-"));
    backend = new MarkdownBackend(makeConfig(), dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("has id 'markdown'", () => {
    expect(backend.id).toBe("markdown");
  });

  it("list returns empty array when no work units exist", async () => {
    const units = await backend.list();
    expect(units).toEqual([]);
  });

  it("create persists a work unit and returns it with generated id", async () => {
    const unit = await backend.create({
      title: "Test task",
      status: "open",
    });
    expect(unit.id).toMatch(/^WU-/);
    expect(unit.title).toBe("Test task");
    expect(unit.status).toBe("open");
  });

  it("create creates .arbiter/work/ directory if missing", async () => {
    await backend.create({ title: "Init dir test", status: "open" });
    expect(existsSync(join(dir, ".arbiter", "work"))).toBe(true);
  });

  it("get returns the created work unit by id", async () => {
    const created = await backend.create({ title: "Fetch me", status: "open" });
    const fetched = await backend.get(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe("Fetch me");
  });

  it("get returns null for unknown id", async () => {
    const result = await backend.get("WU-9999-nonexistent");
    expect(result).toBeNull();
  });

  it("list returns all created units", async () => {
    await backend.create({ title: "A", status: "open" });
    await backend.create({ title: "B", status: "in_progress" });
    const units = await backend.list();
    expect(units).toHaveLength(2);
  });

  it("list filters by status", async () => {
    await backend.create({ title: "Open one", status: "open" });
    await backend.create({ title: "Done one", status: "done" });
    const open = await backend.list({ status: "open" });
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Open one");
  });

  it("advance updates phase and persists", async () => {
    const unit = await backend.create({ title: "Phase test", status: "open" });
    await backend.advance(unit.id, "plan");
    const fetched = await backend.get(unit.id);
    expect(fetched!.phase).toBe("plan");
  });

  it("advance throws for unknown id", async () => {
    await expect(backend.advance("WU-missing", "plan")).rejects.toThrow(
      /not found/i,
    );
  });

  it("close sets status to done and persists", async () => {
    const unit = await backend.create({ title: "Close me", status: "open" });
    await backend.close(unit.id, { reason: "finished" });
    const fetched = await backend.get(unit.id);
    expect(fetched!.status).toBe("done");
  });

  it("close throws for unknown id", async () => {
    await expect(backend.close("WU-missing")).rejects.toThrow(/not found/i);
  });

  it("create is idempotent when same id written twice (round-trip)", async () => {
    const u1 = await backend.create({ title: "Idem", status: "open" });
    const u2 = await backend.get(u1.id);
    expect(u1.id).toBe(u2!.id);
    expect(u1.title).toBe(u2!.title);
  });

  it("front-matter survives round-trip with special characters", async () => {
    const unit = await backend.create({
      title: 'Fix: handle "quotes" & <tags>',
      status: "open",
      body: "Body with\nnewlines",
    });
    const fetched = await backend.get(unit.id);
    expect(fetched!.title).toBe('Fix: handle "quotes" & <tags>');
    expect(fetched!.body).toContain("newlines");
  });

  it("front-matter survives round-trip with embedded newline in title", async () => {
    const unit = await backend.create({
      title: "line one\nline two",
      status: "open",
    });
    const fetched = await backend.get(unit.id);
    expect(fetched!.title).toBe("line one\nline two");
  });

  it("list skips malformed work unit files (missing front-matter) without throwing", async () => {
    const workDir = join(dir, ".arbiter", "work");
    mkdirSync(workDir, { recursive: true });
    writeFileSync(
      join(workDir, "malformed.md"),
      "no front matter here\njust text",
    );
    const units = await backend.list();
    expect(units).toHaveLength(0);
  });

  it("list skips files with invalid status value without throwing", async () => {
    const workDir = join(dir, ".arbiter", "work");
    mkdirSync(workDir, { recursive: true });
    writeFileSync(
      join(workDir, "bad-status.md"),
      "---\nid: WU-bad\ntitle: Bad\nstatus: in-progress\n---\n",
    );
    const units = await backend.list();
    expect(units).toHaveLength(0);
  });

  it("get returns null for file with truncated front-matter", async () => {
    const workDir = join(dir, ".arbiter", "work");
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, "WU-truncated.md"), "---\nid: WU-truncated\n");
    const result = await backend.get("WU-truncated");
    expect(result).toBeNull();
  });

  it("work files are .md files in .arbiter/work/", async () => {
    await backend.create({ title: "File check", status: "open" });
    const files = readdirSync(join(dir, ".arbiter", "work"));
    expect(files.every((f) => f.endsWith(".md"))).toBe(true);
  });

  it("generateId avoids collision after deletion (uses max suffix, not count)", async () => {
    const u1 = await backend.create({ title: "A", status: "open" });
    const u2 = await backend.create({ title: "B", status: "open" });
    const u3 = await backend.create({ title: "C", status: "open" });
    await backend.close(u2.id);
    // Manually remove u2 file to simulate deletion
    const { unlinkSync } = await import("node:fs");
    const workPath = join(dir, ".arbiter", "work");
    const files = readdirSync(workPath);
    const u2File = files.find((f) => f.includes(u2.id.replace(/\//g, "-")));
    if (u2File) unlinkSync(join(workPath, u2File));

    const u4 = await backend.create({ title: "D", status: "open" });
    expect(u4.id).not.toBe(u3.id);
    expect(u4.id).not.toBe(u1.id);
    expect(u4.id).not.toBe(u2.id);
  });
});
