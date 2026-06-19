#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — container image digest-pin gate (#1442)
// Fails closed when a third-party Dockerfile `FROM` base image is not @sha256-pinned,
// so a mutable tag cannot be rewritten under the build (supply-chain hardening).
// Exempt: `FROM scratch`, build-stage alias references (`FROM <prior-AS-alias>`), and any
// FROM line carrying `# arbiter-allow-unpinned[: reason]`. Self-SKIPs (exit 0) when the
// repo ships no Dockerfiles.
// Exit codes (INV-53): 0 = all pinned / none found · 1 = unpinned image(s) · 2 = error.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function parseDir(argv) {
  const i = argv.indexOf('--dir')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd()
}
const ROOT = parseDir(process.argv.slice(2))

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', 'target', '.next'])
const isDockerfile = (name) =>
  name === 'Dockerfile' || name.endsWith('.Dockerfile') || name.startsWith('Dockerfile.')

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue
    const full = join(dir, e)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (isDockerfile(e)) out.push(full)
  }
  return out
}

const SHA_RE = /@sha256:[0-9a-f]{64}/
const ALLOW_RE = /#\s*arbiter-allow-unpinned/
const FROM_RE = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i

let files
try {
  files = walk(ROOT)
} catch (err) {
  process.stderr.write(`check-image-pins: error walking ${ROOT}: ${err.message}\n`)
  process.exit(2)
}

let violations = 0
for (const file of files) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    continue
  }
  const aliases = new Set()
  for (const raw of content.split('\n')) {
    const m = FROM_RE.exec(raw.trim())
    if (!m) continue
    const ref = m[1]
    if (m[2]) aliases.add(m[2].toLowerCase())
    if (ref.toLowerCase() === 'scratch') continue // unpinnable
    if (aliases.has(ref.toLowerCase())) continue // build-stage alias reference
    if (ALLOW_RE.test(raw)) continue // explicit inline allowlist
    if (SHA_RE.test(ref)) continue // digest-pinned
    process.stderr.write(`[FAIL] unpinned base image: FROM ${ref} in ${file}\n`)
    violations++
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-image-pins: FAIL — ${violations} unpinned third-party base image(s). ` +
      'Pin to a @sha256: digest, or add `# arbiter-allow-unpinned: <reason>` to the FROM line.\n',
  )
  process.exit(1)
}
process.stdout.write(
  `check-image-pins: OK — ${files.length} Dockerfile(s) scanned, all base images digest-pinned\n`,
)
process.exit(0)
