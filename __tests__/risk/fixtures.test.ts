import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPath, type RiskLevel } from "../../src/risk/classifier.js";
import type { Language } from "../../src/wizard/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures", "risk");

interface FixtureCase {
  path: string;
  expected: RiskLevel;
}
interface FixtureFile {
  stack: Language;
  cases: FixtureCase[];
}

function load(name: string): FixtureFile {
  return JSON.parse(
    readFileSync(join(FIXTURES, name, "expected.json"), "utf-8"),
  ) as FixtureFile;
}

describe("classifyPath fixtures (#238)", () => {
  for (const name of ["javascript", "python", "rust"]) {
    describe(`stack: ${name}`, () => {
      const fixture = load(name);
      for (const c of fixture.cases) {
        it(`${c.path} → ${c.expected}`, () => {
          expect(classifyPath(c.path, fixture.stack)).toBe(c.expected);
        });
      }
    });
  }
});
