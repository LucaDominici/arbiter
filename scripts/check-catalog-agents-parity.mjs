#!/usr/bin/env node
// INV-51: Every catalog INV-NN must appear in AGENTS.md (CANON-08).
// Usage: node scripts/check-catalog-agents-parity.mjs [--catalog=path] [--agents=path]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const catalogArg = args.find((a) => a.startsWith("--catalog="));
const agentsArg = args.find((a) => a.startsWith("--agents="));

const root = process.cwd();
const catalogPath = catalogArg
  ? resolve(catalogArg.split("=")[1])
  : resolve(root, "src/invariants/catalog.ts");
const agentsPath = agentsArg
  ? resolve(agentsArg.split("=")[1])
  : resolve(root, "AGENTS.md");

const catalogSrc = readFileSync(catalogPath, "utf-8");
const agentsSrc = readFileSync(agentsPath, "utf-8");

const catalogIds = [...catalogSrc.matchAll(/id:\s*"(INV-\d+)"/g)].map(
  (m) => m[1],
);
const agentsIds = new Set(
  [...agentsSrc.matchAll(/INV-(\d+)/g)].map((m) => `INV-${m[1]}`),
);

let violations = 0;
for (const id of catalogIds) {
  if (!agentsIds.has(id)) {
    console.log(`  MISSING from AGENTS.md: ${id}`);
    violations++;
  }
}

if (violations > 0) {
  console.log(
    `[check-catalog-agents-parity] FAIL: ${violations} catalog invariant(s) absent from AGENTS.md`,
  );
  process.exit(1);
}
console.log(
  `[check-catalog-agents-parity] OK — all ${catalogIds.length} catalog IDs present in AGENTS.md`,
);
