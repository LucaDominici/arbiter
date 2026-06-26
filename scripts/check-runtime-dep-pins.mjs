#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — runtime-dependency exact-pin self-check gate (#1557, enforced).
//
// CATALOG: Enforces exact (non-caret) version pins on every published runtime dependency (#1557).
// CATALOG: Rejected fold-in into check-action-pins.mjs because that gate enforces SHA pins on GitHub Actions YAML, a different artifact and spec.
// CATALOG: Rejected fold-in into check-debt-ratchet/audit because supply-chain pin discipline is a hard pass/fail invariant, not a trend metric.
//
// arbiter SHA-pins every GitHub Action (check-action-pins.mjs / INV-76) and emits
// container-digest gates to consumers (#1442), yet its OWN published runtime
// `dependencies` were caret-ranged. npm strips package-lock from published tarballs,
// so `npm install @arbiter/cli` resolves the newest in-range minor/patch at install
// time — the same float-to-latest supply-chain exposure the Action gate forbids. This
// gate mirrors check-action-pins for npm: every entry under `dependencies` must be an
// EXACT version, so what a consumer resolves is byte-for-byte what arbiter ships.
//
// Scope: `dependencies` only — the deps that ship to consumers. `devDependencies` are
// caret-ranged by design (not published, refreshed by Dependabot) and `overrides` is a
// security FLOOR (e.g. uuid ^11.1.1), not a shipped resolution, so neither is gated.
// Enforced: any non-exact runtime dependency spec fails the gate (exit 1).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CWD = process.cwd()
const PKG_PATH = join(CWD, 'package.json')

// EXACT: a bare semver — major.minor.patch with optional prerelease/build metadata.
// Anything with a range operator (^ ~ > < =), wildcard (x *), union (||), hyphen range,
// dist-tag (latest), or non-registry protocol (workspace:/file:/link:/git/http) is NOT
// a reproducible pin and fails. Mirrors check-action-pins' 40-hex SHA_PATTERN.
const EXACT_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

let pkg
try {
  pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'))
} catch (err) {
  // Fail-closed: a missing/unreadable package.json in a Node repo is a gate error, not a pass.
  process.stderr.write(`  check-runtime-dep-pins: cannot read ${PKG_PATH}: ${err.message}\n`)
  process.exit(1)
}

const deps = pkg.dependencies ?? {}
const violations = []
for (const [name, spec] of Object.entries(deps)) {
  if (typeof spec !== 'string' || !EXACT_PATTERN.test(spec)) {
    violations.push({ name, spec: typeof spec === 'string' ? spec : String(spec) })
  }
}

if (violations.length === 0) {
  console.log('  check-runtime-dep-pins: all runtime dependencies are exact-pinned')
  process.exit(0)
}

// Enforced (#1557): a non-exact runtime dependency is a hard stop — fail the gate.
process.stderr.write(
  `  check-runtime-dep-pins: ${violations.length} non-exact runtime dependency spec(s) — ` +
    `#1557 requires exact pins (npm strips package-lock from published tarballs):\n`,
)
for (const v of violations) {
  process.stderr.write(`    ${v.name}@${v.spec}\n`)
}
process.exit(1)
