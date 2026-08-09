#!/usr/bin/env node
// go-library — decision-registry gate (#2036, D-NN orphan check).
// Reads DECISION_REGISTRY.md (or an adopted COSTITUZIONE.md carrying the
// `arbiter:preserve` marker) and fails on ORPHAN decisions: a D-NN table row
// with no Enforcement declaration and no `documentale` exemption.
//
// Grammar (documented in the scaffolded registry):
//   | D-NN | decisione | razionale | decisore | data |
//   Enforcement: <gate|test|documentale>     <- must directly follow the row
//
// Exit codes (INV-53): 0 = PASS/SKIP, 1 = FAIL (orphan decision), 2 = ERROR.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CWD = process.cwd();
const CANDIDATES = ['DECISION_REGISTRY.md', 'COSTITUZIONE.md'];
const registryPath = CANDIDATES.map((c) => join(CWD, c)).find((p) => existsSync(p));

if (!registryPath) {
  // #2052: recognized marker so runCheck surfaces SKIP, not PASS.
  process.stdout.write('[SKIP] no DECISION_REGISTRY.md (or adopted COSTITUZIONE.md) found\n');
  process.exit(0);
}

const source = readFileSync(registryPath, 'utf-8');
if (source.includes('arbiter:preserve')) {
  process.stdout.write(
    '[SKIP] registry carries `arbiter:preserve` — user-owned format, enforcement review is manual\n',
  );
  process.exit(0);
}

// ─── Parse: D-NN table rows + their Enforcement declaration ───────────────────
// A row is `| D-NN | ... |`; its Enforcement line must directly follow (the next
// non-blank line) before the next table row or heading.
const ROW_RE = /^\|\s*(D-\d+)\s*\|/;
const ENFORCEMENT_RE = /^\s*Enforcement:\s*(.+?)\s*$/;
const lines = source.split('\n');
const orphans = [];
const exempt = [];
const enforced = [];
for (let i = 0; i < lines.length; i++) {
  const row = lines[i].match(ROW_RE);
  if (!row) continue;
  const id = row[1];
  // Scan forward to the next table row / heading / blank-then-content boundary.
  let enforcement = null;
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (ROW_RE.test(line)) break;
    if (/^#{1,6}\s/.test(line) || /^\|\s*---/.test(line)) break;
    const decl = line.match(ENFORCEMENT_RE);
    if (decl) {
      enforcement = decl[1].trim();
      break;
    }
    if (line.trim() === '' ) {
      // blank line ends the declaration window unless the next line is Enforcement
      const next = lines[j + 1];
      const nxt = next !== undefined ? next.match(ENFORCEMENT_RE) : null;
      if (!nxt) break;
      enforcement = nxt[1].trim();
      break;
    }
  }
  if (!enforcement || enforcement === '—' || enforcement === '-' || enforcement === 'n/a') {
    orphans.push(id);
  } else if (enforcement.toLowerCase() === 'documentale') {
    exempt.push(id);
  } else {
    enforced.push(id);
  }
}

if (orphans.length > 0) {
  process.stderr.write(
    `check-decision-registry: FAIL — ${orphans.length} orphan decision(s) (no enforcement, no documentale exemption):\n`,
  );
  for (const id of orphans) process.stderr.write(`  - ${id}\n`);
  process.stderr.write(
    'Fix: add `Enforcement: <gate|test>` below the row, or `Enforcement: documentale` for an explicit exemption.\n',
  );
  process.exit(1);
}

if (exempt.length > 0) {
  process.stdout.write(
    `check-decision-registry: PASS — ${enforced.length} enforced, ${exempt.length} documentale-exempt (${exempt.join(', ')}), 0 orphan\n`,
  );
} else {
  process.stdout.write(
    `check-decision-registry: PASS — ${enforced.length} enforced, 0 orphan decisions\n`,
  );
}
process.exit(0);
