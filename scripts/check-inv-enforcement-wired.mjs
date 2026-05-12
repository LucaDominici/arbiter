#!/usr/bin/env node
// INV-52: Every enforcement script cited in catalog must be wired in check-all.mjs (CANON-09).
// Usage: node scripts/check-inv-enforcement-wired.mjs [--catalog=path] [--gate=path]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const catalogArg = args.find((a) => a.startsWith("--catalog="));
const gateArg = args.find((a) => a.startsWith("--gate="));

const root = process.cwd();
const catalogPath = catalogArg
  ? resolve(catalogArg.split("=")[1])
  : resolve(root, "src/invariants/catalog.ts");
const gatePath = gateArg
  ? resolve(gateArg.split("=")[1])
  : resolve(root, "scripts/check-all.mjs");

const catalogSrc = readFileSync(catalogPath, "utf-8");
const gateSrc = readFileSync(gatePath, "utf-8");

const scriptRefs = [
  ...catalogSrc.matchAll(/scripts\/(check-[a-z-]+\.mjs)/g),
].map((m) => m[1]);
const uniqueScripts = [...new Set(scriptRefs)].filter(
  (s) => s !== "check-all.mjs",
);

let violations = 0;
for (const script of uniqueScripts) {
  if (!gateSrc.includes(script)) {
    console.log(`  MISSING from check-all.mjs: ${script}`);
    violations++;
  }
}

if (violations > 0) {
  console.log(
    `[check-inv-enforcement-wired] FAIL: ${violations} enforcement script(s) not wired in gate`,
  );
  process.exit(1);
}
console.log(
  `[check-inv-enforcement-wired] OK — all ${uniqueScripts.length} enforcement scripts wired in check-all.mjs`,
);
