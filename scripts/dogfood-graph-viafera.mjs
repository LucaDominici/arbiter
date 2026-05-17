#!/usr/bin/env node
/**
 * Dogfood script: run `arbiter graph build` on the viafera repo (#259-followup).
 *
 * Skips gracefully if VIAFERA_DIR does not exist.
 * Does NOT modify the viafera repo (output goes to a temp dir by default).
 *
 * Usage:
 *   node scripts/dogfood-graph-viafera.mjs
 *   VIAFERA_DIR=/path/to/viafera node scripts/dogfood-graph-viafera.mjs
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

const VIAFERA_DIR = process.env['VIAFERA_DIR'] ?? join(PROJECT_ROOT, '..', 'viafera')

if (!existsSync(VIAFERA_DIR)) {
  process.stdout.write(`dogfood-graph-viafera: viafera repo not found at ${VIAFERA_DIR} — skipping
`)
  process.stdout.write(`  Set VIAFERA_DIR env var to override.
`)
  process.exit(0)
}

process.stdout.write(`dogfood-graph-viafera: scanning ${VIAFERA_DIR}
`)

// Dynamic import of compiled arbiter graph command (must be built first)
const graphPath = join(PROJECT_ROOT, 'dist', 'commands', 'graph.js')
if (!existsSync(graphPath)) {
  console.error(`dogfood-graph-viafera: dist not found — run \`npm run build\` first`)
  process.exit(1)
}

const { runGraphBuild, runVerifyGraph } = await import(graphPath)

// Use a temp dir so we don't pollute viafera's .arbiter/
const tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-dogfood-viafera-'))

try {
  process.stdout.write(`  graph build (json format)...
`)
  const jsonResult = runGraphBuild({ dir: VIAFERA_DIR, output: join(tmpDir, 'graph.json') })
  if (jsonResult.status !== 'ok') {
    console.error(`  FAIL: ${jsonResult.reason ?? 'unknown error'}`)
    process.exit(1)
  }
  process.stdout
    .write(`  OK: ${jsonResult.nodes} nodes, ${jsonResult.edges} edges → ${jsonResult.path}
`)

  process.stdout.write(`  graph build (dot format)...
`)
  const dotResult = runGraphBuild({
    dir: VIAFERA_DIR,
    output: join(tmpDir, 'graph.dot'),
    format: 'dot',
  })
  if (dotResult.status !== 'ok') {
    console.error(`  FAIL (dot): ${dotResult.reason ?? 'unknown error'}`)
    process.exit(1)
  }
  process.stdout.write(`  OK: dot written → ${dotResult.path}
`)

  process.stdout.write(`  graph build (mermaid format)...
`)
  const mermaidResult = runGraphBuild({
    dir: VIAFERA_DIR,
    output: join(tmpDir, 'graph.mermaid'),
    format: 'mermaid',
  })
  if (mermaidResult.status !== 'ok') {
    console.error(`  FAIL (mermaid): ${mermaidResult.reason ?? 'unknown error'}`)
    process.exit(1)
  }
  process.stdout.write(`  OK: mermaid written → ${mermaidResult.path}
`)

  process.stdout.write(`  verify graph...
`)
  const verifyResult = runVerifyGraph({ input: join(tmpDir, 'graph.json'), dir: VIAFERA_DIR })
  if (verifyResult.status === 'ok') {
    process.stdout.write(`  OK: graph clean (${verifyResult.totalInv} INVs, 0 failures)
`)
  } else {
    // Failures are informational in dogfood — not a hard exit
    const count = verifyResult.failures.length
    process.stdout.write(`  INFO: ${count} verification failure(s): ${verifyResult.reason ?? ''}
`)
    for (const f of verifyResult.failures.slice(0, 10)) {
      process.stdout.write(`    [${f.kind}] ${f.id}: ${f.reason}
`)
    }
    if (count > 10) {
      process.stdout.write(`    ... and ${count - 10} more
`)
    }
  }

  process.stdout.write(`dogfood-graph-viafera: PASS
`)
} finally {
  rmSync(tmpDir, { recursive: true, force: true })
}
