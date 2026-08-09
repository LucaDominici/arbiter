#!/usr/bin/env node
// go-library — gate-layering contract test (#2041, AC-2041.3).
// Asserts the structural containment L1 ⊂ L2 ⊂ L3 from the DECLARATIVE gate
// registry embedded in scripts/check-all.mjs (the #2041 registry, not a
// re-derivation): every L1 gate must be a subset of the L2 slice, which must
// be a subset of the L3 slice, and each gate must belong to exactly one level.
// Exits 0 when the contract holds; 1 when it is violated.
// Exit codes (INV-53): 0 = PASS, 1 = FAIL, 2 = ERROR.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CWD = process.cwd();
const GATE_PATH = join(CWD, 'scripts', 'check-all.mjs');

if (!existsSync(GATE_PATH)) {
  process.stderr.write(`test-gate-layering: FAIL — ${GATE_PATH} not found\n`);
  process.exit(2);
}

const gateSrc = readFileSync(GATE_PATH, 'utf-8');
const match = gateSrc.match(/const GATE_REGISTRY = (\[.*?\]);\n/s);
if (!match) {
  process.stderr.write('test-gate-layering: FAIL — no GATE_REGISTRY embedded in check-all.mjs\n');
  process.exit(2);
}
let registry;
try {
  registry = JSON.parse(match[1]);
} catch (err) {
  process.stderr.write(`test-gate-layering: FAIL — GATE_REGISTRY is not valid JSON: ${err.message}\n`);
  process.exit(2);
}
if (!Array.isArray(registry)) {
  process.stderr.write('test-gate-layering: FAIL — GATE_REGISTRY is not an array\n');
  process.exit(2);
}

const byLevel = { L1: [], L2: [], L3: [] };
for (const gate of registry) {
  if (!gate || typeof gate.id !== 'string' || !byLevel[gate.level]) {
    process.stderr.write(
      `test-gate-layering: FAIL — malformed registry entry: ${JSON.stringify(gate)}\n`,
    );
    process.exit(2);
  }
  byLevel[gate.level].push(gate.id);
}

const violations = [];
const l1 = new Set(byLevel.L1);
const l2 = new Set(byLevel.L2);
const l3 = new Set(byLevel.L3);

// Each gate belongs to exactly one level.
for (const id of byLevel.L1) {
  if (l2.has(id) || l3.has(id)) violations.push(`gate ${id} appears in more than one level`);
}
for (const id of byLevel.L2) {
  if (l3.has(id)) violations.push(`gate ${id} appears in more than one level`);
}

// Containment: the slice run at each level is cumulative — slice(L1) = L1,
// slice(L2) = L1 ∪ L2, slice(L3) = L1 ∪ L2 ∪ L3 — so the structural contract
// `L1 ⊂ L2 ⊂ L3` holds iff slice(L1) ⊆ slice(L2) ⊆ slice(L3) AND each level
// contributes at least one gate (a level with zero gates would be a phantom
// lane). The emitted check-all runs L1 gates always, L2 at L2+, L3 at L3+.
const sliceL2 = new Set([...l1, ...l2]);
const sliceL3 = new Set([...l1, ...l2, ...l3]);
for (const id of l1) {
  if (!sliceL2.has(id) || !sliceL3.has(id)) {
    violations.push(`L1 gate ${id} missing from the cumulative L2/L3 slice (L1 ⊄ L2 ⊂ L3)`);
  }
}
for (const id of l2) {
  if (!sliceL3.has(id)) {
    violations.push(`L2 gate ${id} missing from the cumulative L3 slice (L2 ⊄ L3)`);
  }
}
if (l1.size === 0) violations.push('L1 lane declares zero gates');
if (l2.size === 0) violations.push('L2 lane declares zero gates');
if (l3.size === 0) violations.push('L3 lane declares zero gates');

if (violations.length > 0) {
  process.stderr.write(`test-gate-layering: FAIL — ${violations.length} layering violation(s):\n`);
  for (const v of violations) process.stderr.write(`  - ${v}\n`);
  process.exit(1);
}

process.stdout.write(
  `test-gate-layering: PASS — ${byLevel.L1.length} L1 + ${byLevel.L2.length} L2 + ${byLevel.L3.length} L3 gates, containment L1 ⊂ L2 ⊂ L3 holds\n`,
);
process.exit(0);
