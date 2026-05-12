#!/usr/bin/env node
// INV-47: Every 'proven' cell in cross-language-matrix.json must have a gate invocation
// in src/templates/scripts/check-all.mjs.ejs (CANON-02).
// Usage: node scripts/check-matrix-proven-cells.mjs [--matrix=path] [--template=path] [--exceptions=path]
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const matrixArg = args.find((a) => a.startsWith("--matrix="));
const templateArg = args.find((a) => a.startsWith("--template="));
const exceptionsArg = args.find((a) => a.startsWith("--exceptions="));

const root = process.cwd();
const matrixPath = matrixArg
  ? resolve(matrixArg.split("=")[1])
  : resolve(root, "src/compatibility/cross-language-matrix.json");
const templatePath = templateArg
  ? resolve(templateArg.split("=")[1])
  : resolve(root, "src/templates/scripts/check-all.mjs.ejs");
const exceptionsPath = exceptionsArg
  ? resolve(exceptionsArg.split("=")[1])
  : resolve(root, ".matrix-proven-cells-exceptions.json");

// Extra keywords for tools whose canonical name doesn't appear literally in the template
// but whose functionality is covered through an indirect invocation.
const KEYWORD_OVERRIDES = {
  ArchUnit: ["archunit", "architecture"],
  "RestAssured IT": ["restassured", "integration"],
};

function toolToKeywords(tool) {
  if (KEYWORD_OVERRIDES[tool]) return KEYWORD_OVERRIDES[tool];
  // Split by common delimiters; drop package namespaces (@scope/pkg → pkg)
  return tool
    .toLowerCase()
    .replace(/@[^/]+\//g, "")
    .split(/[\+/\s@()-]+/)
    .filter((t) => t.length >= 3);
}

let matrix;
try {
  matrix = JSON.parse(readFileSync(matrixPath, "utf-8"));
} catch (err) {
  console.log(`[check-matrix-proven-cells] Cannot read matrix: ${err.message}`);
  process.exit(1);
}

const template = readFileSync(templatePath, "utf-8").toLowerCase();

const exceptions = new Set();
if (existsSync(exceptionsPath)) {
  try {
    const exc = JSON.parse(readFileSync(exceptionsPath, "utf-8"));
    for (const e of exc.exceptions ?? []) {
      exceptions.add(`${e.category}/${e.language}`);
    }
  } catch {
    // Ignore malformed exceptions file — no exceptions applied
  }
}

let violations = 0;
for (const [category, langMap] of Object.entries(matrix)) {
  if (category.startsWith("_")) continue;
  if (typeof langMap !== "object" || langMap === null) continue;
  for (const [lang, entry] of Object.entries(langMap)) {
    if (lang.startsWith("_")) continue;
    if (
      typeof entry !== "object" ||
      entry === null ||
      entry.maturity !== "proven"
    )
      continue;

    const key = `${category}/${lang}`;
    if (exceptions.has(key)) {
      console.log(`  SKIP (exception): ${key}: ${entry.tool}`);
      continue;
    }

    const keywords = toolToKeywords(entry.tool);
    const found = keywords.some((k) => template.includes(k));
    if (!found) {
      console.log(
        `  MISSING: ${key}: ${entry.tool} (searched: ${keywords.join(", ")})`,
      );
      violations++;
    }
  }
}

if (violations > 0) {
  console.log(
    `[check-matrix-proven-cells] FAIL: ${violations} proven cell(s) not wired in template`,
  );
  process.exit(1);
}
console.log(
  `[check-matrix-proven-cells] OK — all non-excepted proven cells have template invocations`,
);
