#!/usr/bin/env node
// Arbiter L1 gate: validate hook hardness manifest
// Usage: node scripts/check-hardness-inventory.mjs [--manifest <path>] [--hooks-dir <dir>]
// Checks:
//   1. Drift: every hook file in hooks-dir has a manifest entry; every entry points to existing file
//   2. HARD+spawnable hooks: spawn with fixture, assert exit code matches manifest
//   3. Codex parity: every entry with tools["codex"] is wired in the Codex config template
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// Parse args
const args = process.argv.slice(2)
let manifestPath = join(REPO_ROOT, '.arbiter/hooks-manifest.json')
let hooksDir = join(REPO_ROOT, 'src/templates/claude/hooks')
let codexTemplatePath = join(REPO_ROOT, 'src/templates/codex/config.toml.ejs')
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--manifest' && args[i + 1]) manifestPath = args[++i]
  if (args[i] === '--hooks-dir' && args[i + 1]) hooksDir = args[++i]
  if (args[i] === '--codex-template' && args[i + 1]) codexTemplatePath = args[++i]
}

let failed = 0
function fail(msg) {
  process.stdout.write(`[FAIL] ${msg}\n`)
  failed++
}
function pass(msg) {
  process.stdout.write(`[PASS] ${msg}\n`)
}

// Load manifest
if (!existsSync(manifestPath)) {
  process.stdout.write(`[hardness-drift] manifest not found: ${manifestPath}\n`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
const manifestByFile = new Map(manifest.hooks.map((h) => [h.file, h]))

// ─── 1. Drift detection ───────────────────────────────────────────────────────

// Every hook file in hooksDir (excluding lib.mjs.ejs) must have a manifest entry
const hookFiles = readdirSync(hooksDir)
  .filter((f) => (f.endsWith('.mjs') || f.endsWith('.mjs.ejs')) && f !== 'lib.mjs.ejs')
  .sort()

for (const file of hookFiles) {
  if (!manifestByFile.has(file)) {
    fail(
      `hook file '${file}' has no manifest entry — add it to ${manifestPath} with explicit classification`,
    )
  } else {
    pass(`manifest entry found: ${file}`)
  }
}

// Every manifest entry must point to an existing file in hooksDir
for (const entry of manifest.hooks) {
  const fullPath = join(hooksDir, entry.file)
  if (!existsSync(fullPath)) {
    fail(`manifest entry '${entry.file}' points to non-existent file — drift detected`)
  }
}

// ─── 2. HARD hook empirical assertions ───────────────────────────────────────

const hardSpawnable = manifest.hooks.filter(
  (h) => h.classification === 'HARD' && h.spawnable === true,
)

for (const entry of hardSpawnable) {
  const hookPath = join(hooksDir, entry.file)
  const { fixture, expectedExitCode } = entry

  if (!fixture) {
    fail(`${entry.file} is HARD+spawnable but has no fixture defined in manifest`)
    continue
  }

  const env = { ...process.env }
  const tmpFiles = []

  if (fixture.type === 'file-with-content') {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-hardness-'))
    const tmpFile = join(dir, 'fixture.ts')
    writeFileSync(tmpFile, fixture.content)
    env[fixture.envKey] = tmpFile
    tmpFiles.push(dir)
  } else if (fixture.type === 'env-only') {
    Object.assign(env, fixture.env)
  }

  let result
  try {
    result = spawnSync('node', [hookPath], { encoding: 'utf-8', env })
  } finally {
    for (const d of tmpFiles) rmSync(d, { recursive: true, force: true })
  }

  if (result.status === expectedExitCode) {
    pass(`${entry.file} exits ${expectedExitCode} on violation fixture`)
  } else {
    fail(
      `[hardness-drift] ${entry.file} declared HARD (expected exit ${expectedExitCode}) but exited ${result.status} — ceremony regression detected`,
    )
  }
}

// ─── 3. Codex parity check ────────────────────────────────────────────────────

const codexEntries = manifest.hooks.filter(
  (h) => Array.isArray(h.tools) && h.tools.includes('codex'),
)

if (codexEntries.length > 0) {
  if (!existsSync(codexTemplatePath)) {
    for (const entry of codexEntries) {
      fail(
        `manifest entry '${entry.file}' declares tools:["codex"] but Codex config template not found at ${codexTemplatePath}`,
      )
    }
  } else {
    const codexTemplate = readFileSync(codexTemplatePath, 'utf-8')
    for (const entry of codexEntries) {
      // Strip .ejs suffix from static hooks to get the actual hook filename
      const hookFile = entry.file.replace(/\.ejs$/, '')
      if (codexTemplate.includes(hookFile)) {
        pass(`Codex config template wires adapter for: ${hookFile}`)
      } else {
        fail(
          `manifest entry '${entry.file}' declares tools:["codex"] but '${hookFile}' is missing from Codex config template`,
        )
      }
    }
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

if (failed > 0) {
  process.stdout.write(`\n=== HARDNESS INVENTORY FAILED: ${failed} check(s) ===\n`)
  process.exit(1)
} else {
  process.stdout.write(
    `\n=== HARDNESS INVENTORY PASSED (${hookFiles.length} hooks, ${hardSpawnable.length} HARD empirically verified, ${codexEntries.length} Codex parity verified) ===\n`,
  )
}
