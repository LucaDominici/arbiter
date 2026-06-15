#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Checks that no build artifacts (*.tgz, *.tar.gz), data/state files
// CATALOG:   (*.sqlite/*.sqlite3/*.db/*.db-shm/*.db-wal), or compiled binaries
// CATALOG:   (ELF/Mach-O/PE detected by MAGIC BYTES) are tracked in git.
// CATALOG: Rejected fold-in into check-private-paths-ignored.mjs — that verifies gitignore rules
// CATALOG:   (git check-ignore), not tracked content (git ls-files) — different invariant and axis.
// CATALOG: Rejected fold-in into check-no-redacted-tokens.mjs — content scan, not artifact presence.
// CATALOG: Rejected fold-in into pii-scan.mjs — pii-scan SKIPS binaries by extension and looks for
// CATALOG:   text PII; this is the inverse (it targets the binary/data files pii-scan skips).
// INV-117 (selfOnly): arbiter self-repo must not track binary BUILD artifacts (*.tgz).
// INV-129 (selfOnly:false): no tracked DATA/STATE files (*.sqlite/*.db*) or compiled binaries
//   in the index — a committed finance.sqlite trips neither gitleaks (no secret pattern) nor
//   pii-scan (skips binaries), so this gate is the load-bearing retroactive catch.
// Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR.
import { execFileSync } from 'node:child_process'
import { openSync, readSync, closeSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const GIT_CWD = process.env['ARBITER_HOOK_GIT_CWD'] ?? ROOT

// Glob-matched banned artifacts: build outputs + data/state files.
const BANNED_PATTERNS = [
  '*.tgz',
  '*.tar.gz',
  '*.sqlite',
  '*.sqlite3',
  '*.db',
  '*.db-shm',
  '*.db-wal',
]

// Allowlist — intentional committed binaries that this gate must NOT flag.
// (1) extension-based: assets that are legitimately binary (fonts, images, wasm).
const ALLOWLISTED_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.svg', // text but cheap to include
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.wasm',
  '.pdf',
])
// (2) path-prefix based: deliberate test/fixture binaries (matrix fixtures, ELF probes).
const ALLOWLISTED_PATH_PREFIXES = ['__tests__/fixtures/', 'tests/fixtures/', 'fixtures/']

function isAllowlisted(file) {
  const ext = extname(file).toLowerCase()
  if (ALLOWLISTED_EXTS.has(ext)) return true
  const norm = file.replace(/\\/g, '/')
  return ALLOWLISTED_PATH_PREFIXES.some((p) => norm.startsWith(p) || norm.includes(`/${p}`))
}

// Magic-byte signatures (PRIMARY signal) for compiled binaries.
// ELF: 7F 45 4C 46 | Mach-O: FEEDFACE / CEFAEDFE / FEEDFACF / CFFAEDFE / CAFEBABE | PE: 4D 5A (MZ).
function readMagic(absPath) {
  let fd
  try {
    fd = openSync(absPath, 'r')
    const buf = Buffer.alloc(4)
    const n = readSync(fd, buf, 0, 4, 0)
    return buf.subarray(0, n)
  } catch {
    return Buffer.alloc(0)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function isCompiledBinary(absPath) {
  const m = readMagic(absPath)
  if (m.length < 2) return false
  const b0 = m[0]
  const b1 = m[1]
  const b2 = m[2]
  const b3 = m[3]
  // ELF
  if (b0 === 0x7f && b1 === 0x45 && b2 === 0x4c && b3 === 0x46) return true
  // PE / DOS (MZ)
  if (b0 === 0x4d && b1 === 0x5a) return true
  // Mach-O fat/thin (big- and little-endian 32/64)
  if (m.length === 4) {
    const u32 = m.readUInt32BE(0)
    if (
      u32 === 0xfeedface ||
      u32 === 0xfeedfacf ||
      u32 === 0xcefaedfe ||
      u32 === 0xcffaedfe ||
      u32 === 0xcafebabe ||
      u32 === 0xbebafeca
    ) {
      return true
    }
  }
  return false
}

function lsFiles(args) {
  return execFileSync('git', ['ls-files', ...args], { cwd: GIT_CWD, encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(Boolean)
}

let failures = 0
try {
  // Fail-closed: a non-git CWD is an ERROR (exit 2), never a silent PASS (NO-DATA≠PASS).
  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: GIT_CWD, stdio: 'pipe' })

  // 1) Glob-matched banned artifacts (build + data/state).
  for (const pattern of BANNED_PATTERNS) {
    for (const f of lsFiles([pattern])) {
      if (isAllowlisted(f)) continue
      process.stderr.write(`check-no-tracked-artifacts: FAIL — tracked artifact: ${f}\n`)
      failures++
    }
  }

  // 2) Magic-byte compiled binaries (primary signal — language-agnostic).
  //    Secondary HINT only: a Go module-root binary is typically named after the
  //    module basename (go.mod) and a Rust release binary lives under target/ — but
  //    detection is driven by the magic bytes, not the name, so renamed binaries
  //    cannot evade the gate.
  // Extensions already covered by the glob pass (avoid double-reporting).
  const GLOB_EXTS = new Set(['.tgz', '.sqlite', '.sqlite3', '.db', '.db-shm', '.db-wal'])
  for (const f of lsFiles([])) {
    if (isAllowlisted(f)) continue
    const ext = extname(f).toLowerCase()
    if (GLOB_EXTS.has(ext) || f.endsWith('.tar.gz')) continue
    const abs = resolve(GIT_CWD, f)
    if (isCompiledBinary(abs)) {
      process.stderr.write(`check-no-tracked-artifacts: FAIL — tracked compiled binary: ${f}\n`)
      failures++
    }
  }
} catch (err) {
  process.stderr.write(
    `check-no-tracked-artifacts: ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}

if (failures > 0) {
  process.exit(1)
}
process.stdout.write('check-no-tracked-artifacts: OK\n')
process.exit(0)
