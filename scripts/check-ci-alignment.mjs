#!/usr/bin/env node
// check-ci-alignment.mjs — CI/manifest gate alignment checker (#240)
// Parses scripts/check-all.mjs (manifest) and .github/workflows/ci.yml (CI),
// reconciles gate keys, and fails on any mismatch.
//
// Exit codes:
//   0 — manifest and CI gates are aligned
//   1 — mismatches found (manifest-only or ci-only gates)
//
// Usage: node scripts/check-ci-alignment.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, "scripts", "check-all.mjs");
// Reconcile against the primary gate workflow only; other workflows
// (matrix-refresh.yml, real-project-matrix.yml, nightly.yml) have a different
// purpose and are not subject to manifest-gate parity.
const CI_WORKFLOW_PATH = join(ROOT, ".github", "workflows", "ci.yml");

// ─── Infra run-command prefixes to skip ──────────────────────────────────────
// These are infrastructure commands, not quality gates.
const INFRA_RUN_PREFIXES = [
  "npm ci",
  "npm install",
  "git fetch",
  "git checkout",
  "curl ",
  "echo ",
  "mkdir ",
  "cp ",
  "tar ",
  "pip install",
  "apt-get",
];

// ─── Gates that are deliberately handled differently in CI vs manifest ────────
// Each entry explains WHY the gate is exempt from the alignment check.
// Keys match the normalized gate key format used in extractManifestGates().
const DESIGN_EXEMPTIONS = new Set([
  // docs: manifest runs check-docs.mjs via GIT_CWD; CI has an inline shell
  // job (docs-check) that performs the same check without the script.
  "scripts/check-docs.mjs",

  // commitlint: conditional in both manifest and CI (PR-only). The manifest
  // always registers the runCheck call but it passes trivially on push;
  // CI only runs it on pull_request. Both honour the same rule.
  "npx:commitlint",

  // unit tests: manifest uses `npm test`; CI splits into test:unit/contract/
  // integration/behavioral jobs. The gate is structurally equivalent.
  "npm:test",

  // audit: manifest places it in L2; CI runs it in lint-and-test job.
  // Both enforce the same check; the level placement differs by design.
  "npm:audit",

  // knip (dead code): same as audit — L2 in manifest, lint-and-test in CI.
  "npx:knip",

  // local-ci parity: L2-only local gate; CI equivalent is the gate-aggregation
  // artifact comparison. No corresponding CI step — intentionally local-only.
  "scripts/check-local-ci-parity.mjs",

  // check-all.mjs: CI gate-aggregation job runs `node scripts/check-all.mjs L1
  // --json gate-result.json` to produce the canonical parity artifact. This is
  // the aggregation runner, not a quality gate itself.
  "scripts/check-all.mjs",
]);

// ─── Extract gate keys from check-all.mjs ────────────────────────────────────
// Parses runCheck(...) calls and derives a normalized gate key from cmd+args.
function extractManifestGates(content) {
  const gates = new Set();
  // Match: runCheck("name", "cmd", ["arg0", ...])
  const re = /runCheck\(\s*"[^"]*"\s*,\s*"([^"]+)"\s*,\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const cmd = m[1].trim();
    const argsRaw = m[2];
    // Extract first string argument
    const firstArgMatch = argsRaw.match(/"([^"]+)"/);
    const firstArg = firstArgMatch ? firstArgMatch[1] : "";
    const key = normalizeGateKey(cmd, firstArg);
    if (key !== null) gates.add(key);
  }
  return gates;
}

// ─── Extract gate keys from a CI workflow file ────────────────────────────────
function extractCiGates(workflowPath) {
  const gates = new Set();
  let content;
  try {
    content = readFileSync(workflowPath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return gates; // missing workflow → no CI gates
    throw err;
  }
  extractCiGatesFromYaml(content, gates);
  return gates;
}

// Parse a YAML file for `run:` commands using a line-level approach (no
// runtime YAML dependency). Block scalars (run: |) are handled by checking
// for the marker BEFORE the single-line pattern to avoid swallowing `|`.
function extractCiGatesFromYaml(content, gates) {
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip `uses:` steps — they are actions, not run commands
    if (/^\s+-?\s*uses:\s*.+/.test(line)) {
      i++;
      continue;
    }

    // Block scalar run: | or run: > (checked FIRST to avoid consuming the `|`)
    const blockRunMatch = line.match(/^(\s*)-?\s*run:\s*[|>]\s*$/);
    if (blockRunMatch) {
      const baseIndent = blockRunMatch[1].length;
      i++;
      while (i < lines.length) {
        const bodyLine = lines[i];
        if (bodyLine.trim() === "") {
          i++;
          continue;
        }
        const bodyIndent = bodyLine.match(/^(\s*)/)?.[1].length ?? 0;
        if (bodyIndent <= baseIndent && bodyLine.trim() !== "") break;
        parseRunCommand(bodyLine.trim(), gates);
        i++;
      }
      continue;
    }

    // Single-line run: command
    const singleRunMatch = line.match(/^\s+-?\s*run:\s*(.+)/);
    if (singleRunMatch) {
      const cmd = singleRunMatch[1].trim();
      parseRunCommand(cmd, gates);
      i++;
      continue;
    }

    i++;
  }
}

// Parse a single shell command line and add a gate key to the set.
function parseRunCommand(cmd, gates) {
  if (!cmd || isInfraCommand(cmd)) return;

  const tokens = cmd.split(/\s+/);
  if (tokens.length === 0) return;

  const cmd0 = tokens[0];
  const arg0 = tokens[1] ?? "";

  if (cmd0 === "node" && arg0) {
    const key = normalizeGateKey("node", arg0);
    if (key !== null) gates.add(key);
    return;
  }

  const key = normalizeGateKey(cmd0, arg0);
  if (key !== null) gates.add(key);
}

// Derive a canonical gate key from a (cmd, firstArg) pair.
function normalizeGateKey(cmd, firstArg) {
  switch (cmd) {
    case "node":
      if (firstArg && firstArg.startsWith("scripts/")) {
        return firstArg;
      }
      return null;

    case "npx": {
      if (!firstArg) return null;
      const tool = firstArg.replace(/@.+$/, "");
      return `npx:${tool}`;
    }

    case "npm":
      if (firstArg === "test") return "npm:test";
      if (firstArg === "audit") return "npm:audit";
      if (firstArg === "run") return null;
      if (firstArg === "ci" || firstArg === "install") return null;
      return null;

    case "gitleaks":
      return "gitleaks";

    default:
      return null;
  }
}

function isInfraCommand(cmd) {
  return INFRA_RUN_PREFIXES.some((prefix) => cmd.startsWith(prefix));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
let manifestContent;
try {
  manifestContent = readFileSync(MANIFEST_PATH, "utf-8");
} catch (err) {
  process.stderr.write(
    `check-ci-alignment: cannot read ${MANIFEST_PATH}: ${err.message}\n`,
  );
  process.exit(1);
}

const manifestGates = extractManifestGates(manifestContent);
const ciGates = extractCiGates(CI_WORKFLOW_PATH);

// Remove exemptions from both sets before comparing
for (const key of DESIGN_EXEMPTIONS) {
  manifestGates.delete(key);
  ciGates.delete(key);
}

const manifestOnly = [...manifestGates].filter((k) => !ciGates.has(k));
const ciOnly = [...ciGates].filter((k) => !manifestGates.has(k));

let violations = 0;

if (manifestOnly.length > 0) {
  process.stderr.write(
    `\ncheck-ci-alignment: gates in manifest but NOT in CI (manifest-only):\n`,
  );
  for (const key of manifestOnly) {
    process.stderr.write(`  manifest-only: ${key}\n`);
    violations++;
  }
}

if (ciOnly.length > 0) {
  process.stderr.write(
    `\ncheck-ci-alignment: gates in CI but NOT in manifest (ci-only):\n`,
  );
  for (const key of ciOnly) {
    process.stderr.write(`  ci-only: ${key}\n`);
    violations++;
  }
}

if (violations > 0) {
  process.stderr.write(
    `\n  ${violations} alignment violation(s). Ensure every L1 gate in scripts/check-all.mjs has a corresponding step in .github/workflows/ci.yml and vice versa.\n\n`,
  );
  process.exit(1);
} else {
  process.stdout.write(
    `check-ci-alignment: OK (${manifestGates.size} gates aligned)\n`,
  );
}
