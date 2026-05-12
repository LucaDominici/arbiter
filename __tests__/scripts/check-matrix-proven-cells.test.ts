import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve("scripts/check-matrix-proven-cells.mjs");
const REAL_MATRIX = resolve("src/compatibility/cross-language-matrix.json");
const REAL_TEMPLATE = resolve("src/templates/scripts/check-all.mjs.ejs");
const REAL_EXCEPTIONS = resolve(".matrix-proven-cells-exceptions.json");

function run(
  matrixPath: string,
  templatePath: string,
  exceptionsPath?: string,
): { status: number; stdout: string; stderr: string } {
  const args = [SCRIPT, `--matrix=${matrixPath}`, `--template=${templatePath}`];
  if (exceptionsPath) args.push(`--exceptions=${exceptionsPath}`);
  const r = spawnSync("node", args, { encoding: "utf-8", cwd: resolve(".") });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "canon02-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makeMatrix(
  cells: Array<{ cat: string; lang: string; tool: string; maturity?: string }>,
): string {
  const obj: Record<string, Record<string, unknown>> = {};
  for (const { cat, lang, tool, maturity = "proven" } of cells) {
    obj[cat] ??= {};
    obj[cat][lang] = { tool, maturity };
  }
  return JSON.stringify(obj);
}

describe("check-matrix-proven-cells.mjs (INV-47 / CANON-02)", () => {
  it("exits 0 when all proven tools appear in the template", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const matrix = join(dir, "matrix.json");
      const template = join(dir, "check-all.mjs.ejs");
      const noExceptions = join(dir, "exc.json");
      writeFileSync(
        matrix,
        makeMatrix([
          { cat: "static_analysis", lang: "go", tool: "golangci-lint" },
        ]),
      );
      writeFileSync(template, "runCheck('lint', 'golangci-lint', ['run'])");
      writeFileSync(noExceptions, JSON.stringify({ exceptions: [] }));
      expect(run(matrix, template, noExceptions).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 1 when a proven tool is absent from the template", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const matrix = join(dir, "matrix.json");
      const template = join(dir, "check-all.mjs.ejs");
      const noExceptions = join(dir, "empty-exceptions.json");
      writeFileSync(
        matrix,
        makeMatrix([{ cat: "mutation", lang: "typescript", tool: "stryker" }]),
      );
      writeFileSync(template, "// mutation tool not wired");
      writeFileSync(noExceptions, JSON.stringify({ exceptions: [] }));
      const result = run(matrix, template, noExceptions);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("stryker");
    } finally {
      cleanup();
    }
  });

  it("skips non-proven cells (beta, unavailable)", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const matrix = join(dir, "matrix.json");
      const template = join(dir, "check-all.mjs.ejs");
      const noExceptions = join(dir, "exc.json");
      writeFileSync(
        matrix,
        makeMatrix([
          {
            cat: "mutation",
            lang: "rust",
            tool: "cargo-mutants",
            maturity: "beta",
          },
        ]),
      );
      writeFileSync(template, "// no cargo-mutants here");
      writeFileSync(noExceptions, JSON.stringify({ exceptions: [] }));
      expect(run(matrix, template, noExceptions).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 0 for a known exception (e.g. pitest)", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const matrix = join(dir, "matrix.json");
      const template = join(dir, "check-all.mjs.ejs");
      const exceptions = join(dir, "exceptions.json");
      writeFileSync(
        matrix,
        makeMatrix([{ cat: "mutation", lang: "java", tool: "pitest" }]),
      );
      writeFileSync(template, "// pitest not wired");
      writeFileSync(
        exceptions,
        JSON.stringify({
          exceptions: [
            {
              category: "mutation",
              language: "java",
              tool: "pitest",
              reason: "TODO(#247)",
            },
          ],
        }),
      );
      expect(run(matrix, template, exceptions).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("uses keyword overrides for compound tool names", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const matrix = join(dir, "matrix.json");
      const template = join(dir, "check-all.mjs.ejs");
      const noExceptions = join(dir, "exc.json");
      writeFileSync(
        matrix,
        makeMatrix([{ cat: "architecture", lang: "java", tool: "ArchUnit" }]),
      );
      writeFileSync(
        template,
        "runCheck('architecture tests', './gradlew', ['test'])",
      );
      writeFileSync(noExceptions, JSON.stringify({ exceptions: [] }));
      expect(run(matrix, template, noExceptions).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("passes against the real matrix and template (with exceptions)", () => {
    const result = run(REAL_MATRIX, REAL_TEMPLATE, REAL_EXCEPTIONS);
    expect(result.status).toBe(0);
  });
});
