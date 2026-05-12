#!/usr/bin/env node
// Gate: verify every file listed in SSOT_CORE_SET.md exists on disk. (INV-54, #255)
// Exits 0: all entries exist or no SSOT_CORE_SET.md found (bootstrap mode).
// Exits 1: one or more listed files are missing.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SSOT_FILE = join(process.cwd(), "docs", "METHOD", "SSOT_CORE_SET.md");

if (!existsSync(SSOT_FILE)) {
  console.log(
    "  check-ssot-core: no SSOT_CORE_SET.md found — skipping (bootstrap mode)",
  );
  process.exit(0);
}

const content = readFileSync(SSOT_FILE, "utf-8");

// Match bullet items with backtick-quoted paths: - `path/to/file.md` — ...
const PATH_ITEM = /^[ \t]*-[ \t]+`([^`]+)`/gm;

const missing = [];
let m;
while ((m = PATH_ITEM.exec(content)) !== null) {
  const filePath = m[1];
  const abs = join(process.cwd(), filePath);
  if (!existsSync(abs)) {
    missing.push(filePath);
  }
}

if (missing.length === 0) {
  console.log("  check-ssot-core: all SSOT_CORE_SET entries exist");
  process.exit(0);
}

console.log(
  `  check-ssot-core: ${missing.length} missing file(s) listed in SSOT_CORE_SET.md:`,
);
for (const f of missing) {
  console.log(`    missing: ${f}`);
}
process.exit(1);
