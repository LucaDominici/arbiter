#!/usr/bin/env node
// CATALOG: fail-closed duplication gate — runs jscpd v5 with the fileset from
// CATALOG: .jscpd.json#path and FAILS on config drift or a 0-source scan (which
// CATALOG: jscpd v5 exits 0 on, silently neutering a bare `npx jscpd` gate).
// CATALOG: rejected fold-in into debt-report.mjs because that is the ratchet leg
// CATALOG: (baseline comparison); this is the absolute threshold leg (#1286).
// Exits 1 on: unreadable config, missing/empty `path`, jscpd failure, missing
// report, 0 sources, or threshold breach (jscpd exit 1). CANON-22 / INV-96.
import { jscpdScan } from './debt-lib.mjs'

try {
  const scan = jscpdScan(process.cwd())
  if (scan.skipped) {
    process.stdout.write('[duplication] FAIL: npx not available — cannot run jscpd\n')
    process.exit(1)
  }
  if (scan.error) {
    process.stdout.write(`[duplication] FAIL: ${scan.error}\n`)
    process.exit(1)
  }
  if (scan.legacyNoReport) {
    // v5 always writes the report; reaching this branch means a v4 binary is
    // installed — the self repo pins v5, so treat as drift.
    process.stdout.write(
      '[duplication] FAIL: no report written on exit 0 — jscpd v4 semantics detected; expected v5 (#1286)\n',
    )
    process.exit(1)
  }
  if ((scan.status ?? 0) !== 0) {
    process.stdout.write(
      `[duplication] FAIL: jscpd exit ${scan.status} — duplication over threshold (${scan.percentage}% across ${scan.sources} files)\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `[duplication] OK: ${scan.percentage.toFixed(2)}% duplicated lines across ${scan.sources} files\n`,
  )
} catch (err) {
  process.stdout.write(`[duplication] FAIL: ${err.message}\n`)
  process.exit(1)
}
