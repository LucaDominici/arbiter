#!/usr/bin/env node
// check-node-version-ssot.mjs — enforce Node version SSOT via .nvmrc (INV-53)
//
// Checks:
//   1. .nvmrc exists and contains a valid semver patch (N.N.N)
//   2. No workflow or template file contains a literal node-version: 'N' or "N" pin
//   3. process.version major matches .nvmrc major
//
// Exit codes:
//   0 — all checks pass
//   1 — any violation found
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = process.cwd()
let failures = 0

function fail(msg) {
  console.error(`  FAIL  ${msg}`)
  failures++
}

// ─── 1. .nvmrc exists + valid format ─────────────────────────────────────────
let nvmrcVersion
try {
  nvmrcVersion = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim()
  if (!/^\d+\.\d+\.\d+$/.test(nvmrcVersion)) {
    fail(`.nvmrc must contain an exact semver patch (N.N.N), got: ${nvmrcVersion}`)
    nvmrcVersion = null
  }
} catch {
  fail('.nvmrc not found — create it with the canonical Node version (e.g. 22.21.1)')
}

// ─── 2. Scan for literal node-version pins ───────────────────────────────────
const LITERAL_PIN_RE = /node-version:\s*['"]?\d+['"]?(?!\s*-file)/

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  lines.forEach((line, i) => {
    if (LITERAL_PIN_RE.test(line)) {
      fail(`Literal node-version pin in ${filePath}:${i + 1} → ${line.trim()}`)
    }
  })
}

function walkDir(dir, exts) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walkDir(full, exts)
    } else if (exts.includes(extname(entry))) {
      scanFile(full)
    }
  }
}

walkDir(join(ROOT, '.github', 'workflows'), ['.yml', '.yaml'])
walkDir(join(ROOT, 'src', 'templates'), ['.ejs', '.yml', '.yaml'])

// ─── 3. process.version major matches .nvmrc major ───────────────────────────
if (nvmrcVersion) {
  const nvmrcMajor = parseInt(nvmrcVersion.split('.')[0], 10)
  const runtimeMajor = parseInt(process.version.slice(1).split('.')[0], 10)
  if (runtimeMajor !== nvmrcMajor) {
    fail(
      `Runtime Node ${process.version} (major ${runtimeMajor}) ≠ .nvmrc major ${nvmrcMajor}. Run: nvm use`,
    )
  }
}

// ─── Result ──────────────────────────────────────────────────────────────────
if (failures === 0) {
  process.stdout
    .write(`  OK    node-version-ssot — .nvmrc=${nvmrcVersion}, runtime=${process.version}
`)
  process.exit(0)
} else {
  console.error(`  FAIL  node-version-ssot — ${failures} violation(s) found (INV-53)`)
  process.exit(1)
}
