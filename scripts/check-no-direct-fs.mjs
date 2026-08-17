#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: CANON-17 / #1991 — src/utils/fs.ts is the SOLE approved write façade for src/.
// CATALOG: Replaces check-no-direct-fs-in-generators.mjs, which enforced the same op set
// CATALOG: over src/generators/ only, and subsumes the #1733 test-only guard that watched
// CATALOG: top-level src/commands/*.ts. Rejected fold-in into check-no-direct-spawn.mjs
// CATALOG: (different rule class — child_process, not fs) and into check-all.mjs (needs a
// CATALOG: dated-pin allowlist of its own, which check-all.mjs holds no state for).
//
// Why: a direct node:fs write lets a raw errno (ENOENT/EACCES/EROFS/...) reach the user as
// an unstyled Node stack instead of an ArbiterError carrying an actionable i18n hint. The
// façade's toFsError is the single translation point; bypassing it is how CANON-17 is
// violated in practice.
//
// Scope: all of src/ recursively, EXCEPT src/templates/ (EJS sources rendered into consumer
// repos, not arbiter's own runtime) and src/utils/fs.ts itself (it IS the façade).
//
// Op set — stated once, here, and nowhere else. Every op in it has a façade route; an op
// with nowhere to go does not belong in a gate.
//   sync:     writeFileSync, mkdirSync, copyFileSync, appendFileSync, renameSync,
//             chmodSync, unlinkSync, rmSync, symlinkSync, mkdtempSync
//   promises: writeFile, mkdir, copyFile, appendFile, rename,
//             chmod, unlink, rm, symlink, mkdtemp
//
// The boundary is MUTATION, and that is a decision, not a leftover (#1991, closed scoped).
// Reads (readFileSync/existsSync/readdirSync/statSync/lstatSync/readlinkSync) stay OUT of
// an IMPORT-shaped gate, on measured grounds — 80 real readFileSync call sites in src/:
//   - 47 sit in a try/catch with a non-rethrowing fallback (`catch { continue }`,
//     `catch { return null }`). An ArbiterError is swallowed byte-for-byte like an errno,
//     so migrating them changes nothing a user sees. CANON-17 already exempts this shape
//     ("a structured domain result", "a keyed logger call").
//   - 8 rethrow, already translated. At least 3 of those (utils/canon-loader.ts,
//     commands/worktree.ts, utils/safe-read.ts) BRANCH ON `err.code`; routing them through
//     a translator would silently kill the ENOENT arm. CANON-17 exempts this shape too.
//   - 25 are bare. Those ARE a live CANON-17 leak (cli.ts's top-level handler prints
//     `Unexpected error: ENOENT: ...`), and eslint-rules/fs-errno-translation.js cannot
//     see them — with no catch binding there is nothing for it to report. Tracked as
//     #2293: this gate keys on IMPORTS, so adding readFileSync to the op set would flag
//     all 56 importing files, 55 of them compliant. The fix is a per-CALL rule, not
//     another name in the list above.
// Also known-uncovered, and out of the op set because they need primitives that do not
// exist yet rather than a name: cpSync (worktree/links.ts, worktree/harvest.ts) and the
// openSync('wx')+writeSync pair in utils/file-lock.ts, which writes a whole file without
// touching writeFileSync once. Both tracked as #2294 — note that until it lands, the
// "SOLE approved write façade" claim at the top of this file is true for the op set
// above and not for the word "write".
//
// Allowlist: .no-direct-fs-allowlist — "path  EXPIRES: YYYY-MM-DD  # reason", one per line.
// Every pin MUST carry a future date AND a reason, and a pin whose path no longer violates
// is itself a failure: a ledger that accepts undated or stale lines is a bypass, not a gate.
//
// Usage: node scripts/check-no-direct-fs.mjs [--root <dir>]
// Exit codes (INV-53): 0 PASS, 1 FAIL, 2 invocation / IO error.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const WRITE_OPS = [
  'writeFileSync',
  'mkdirSync',
  'copyFileSync',
  'appendFileSync',
  'renameSync',
  'chmodSync',
  'unlinkSync',
  'rmSync',
  'rmdirSync',
  'symlinkSync',
  'mkdtempSync',
  'cpSync',
  'openSync',
  'writeSync',
]
const PROMISE_WRITE_OPS = [
  'writeFile',
  'mkdir',
  'copyFile',
  'appendFile',
  'rename',
  'chmod',
  'unlink',
  'rm',
  'rmdir',
  'symlink',
  'mkdtemp',
]

const ALLOWLIST_FILE = '.no-direct-fs-allowlist'
const EXCLUDED_DIRS = new Set(['templates'])
const FACADE = 'src/utils/fs.ts'

/** `import { a, b as c } from 'node:fs'` / "node:fs" — returns the LOCAL binding names. */
function namedImports(src, moduleName) {
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${moduleName}['"]`, 'g')
  const locals = []
  for (const m of src.matchAll(re)) {
    for (const part of m[1].split(',')) {
      const [imported, local] = part.split(/\s+as\s+/).map((x) => x.trim())
      if (imported) locals.push({ imported, local: local || imported })
    }
  }
  return locals
}

/** `import fs from 'node:fs'` / `import * as fs from 'node:fs'` — returns binding names. */
function wholeModuleImports(src, moduleName) {
  const re = new RegExp(`import\\s+(?:\\*\\s+as\\s+)?(\\w+)\\s+from\\s*['"]${moduleName}['"]`, 'g')
  return [...src.matchAll(re)].map((m) => m[1])
}

function violationsIn(src, ops) {
  const found = new Set()
  for (const mod of ['node:fs', 'node:fs/promises']) {
    const opSet = mod === 'node:fs' ? ops.sync : ops.promises
    for (const { imported } of namedImports(src, mod)) {
      if (opSet.includes(imported)) found.add(`${mod} ${imported}`)
    }
    for (const binding of wholeModuleImports(src, mod)) {
      for (const op of opSet) {
        // A namespace/default import only violates when a write is actually CALLED on it —
        // `fs.existsSync` alone is a read and must not be flagged.
        if (new RegExp(`\\b${binding}\\.${op}\\s*\\(`).test(src))
          found.add(`${mod} ${binding}.${op}`)
      }
    }
  }
  return [...found].sort()
}

function walk(dir, root, out) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    let st
    try {
      st = statSync(abs)
      // FAIL-OPEN-INTENT: a dangling symlink has no file to scan, so skipping it cannot hide a violation; an unreadable REAL file fails closed at readFileSync below.
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue
      walk(abs, root, out)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(relative(root, abs).replace(/\\/g, '/'))
    }
  }
  return out
}

/** Parse the allowlist. Returns { pins: Map<path,{expires,reason,raw}>, errors: string[] }. */
function loadAllowlist(root) {
  const path = join(root, ALLOWLIST_FILE)
  const pins = new Map()
  const errors = []
  if (!existsSync(path)) return { pins, errors }
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const text = line.trim()
    if (text === '' || text.startsWith('#')) continue
    const [entry] = text.split('#')
    const reason = text.includes('#') ? text.slice(text.indexOf('#') + 1).trim() : ''
    const m = entry.match(/^(\S+)\s+EXPIRES:\s*(\S+)\s*$/)
    if (!m) {
      errors.push(`  ${text}: malformed — expected "path  EXPIRES: YYYY-MM-DD  # reason"`)
      continue
    }
    const [, file, date] = m
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      errors.push(`  ${file}: EXPIRES "${date}" is not a valid YYYY-MM-DD date`)
      continue
    }
    if (reason === '') {
      errors.push(`  ${file}: pin has no reason — a bare path explains nothing`)
      continue
    }
    pins.set(file, { expires: new Date(date), reason, raw: date })
  }
  return { pins, errors }
}

/** Classify one file against the op set and the pin ledger. Extracted from `main` to keep
 *  its cyclomatic complexity under the repo ceiling (CANON-22). */
function checkFile(rel, src, ctx) {
  const { ops, pins, now, violations, offenders } = ctx
  const hits = violationsIn(src, ops)
  if (hits.length === 0) return
  offenders.add(rel)

  const pin = pins.get(rel)
  if (!pin) {
    violations.push(
      `  ${rel}: direct write import (${hits.join(', ')}) — route through src/utils/fs.ts ` +
        `(writeFileTranslated / ensureDir / appendFileTranslated / copyFileTranslated / ` +
        `renameTranslated / chmodTranslated / unlinkTranslated / rmTranslated / ` +
        `symlinkTranslated / mkdtempTranslated) or add a dated pin to ${ALLOWLIST_FILE}`,
    )
    return
  }
  if (pin.expires.getTime() < now) {
    violations.push(
      `  ${rel}: allowlist EXPIRES ${pin.raw} has lapsed — re-decide, do not re-date blindly`,
    )
  }
}

function main() {
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf('--root')
  const root = resolve(rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : '.')
  const srcDir = join(root, 'src')
  if (!existsSync(srcDir)) {
    process.stdout.write('check-no-direct-fs: OK — no src/ directory\n')
    return 0
  }

  const { pins, errors } = loadAllowlist(root)
  const ops = { sync: WRITE_OPS, promises: PROMISE_WRITE_OPS }
  const now = Date.now()
  const violations = [...errors]
  const offenders = new Set()

  for (const rel of walk(srcDir, root, [])) {
    if (rel === FACADE) continue
    // Fail CLOSED: an unreadable source file could contain anything, and reporting OK over
    // it would be a false green — the exact failure INV-96 exists to prevent.
    checkFile(rel, readFileSync(join(root, rel), 'utf-8'), {
      ops,
      pins,
      now,
      violations,
      offenders,
    })
  }

  // A pin for a path that no longer violates is stale: it silently pre-approves a future
  // regression at that path. Remove it rather than letting it rot.
  for (const [file] of pins) {
    if (!offenders.has(file)) {
      violations.push(`  ${file}: allowlisted but no longer violates — stale pin, remove it`)
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `check-no-direct-fs: ${violations.length} problem(s) — src/utils/fs.ts must be the sole write façade (CANON-17):\n`,
    )
    for (const v of violations) process.stderr.write(v + '\n')
    return 1
  }
  process.stdout.write(`check-no-direct-fs: OK — ${pins.size} dated pin(s)\n`)
  return 0
}

try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-no-direct-fs: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}
