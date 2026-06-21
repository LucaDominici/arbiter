#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Install-command gate (B1) — rejects user-facing docs that tell a
// CATALOG: reader to run the UNSCOPED `npx arbiter` / `npm install arbiter`
// CATALOG: command. The published package is the SCOPED `@arbiter/cli`; the
// CATALOG: unscoped `arbiter` name resolves to an unrelated third-party npm
// CATALOG: package, so an unscoped headline install is a broken/unsafe onboarding
// CATALOG: path. Cannot fold into check-doc-links.mjs (link resolution, not
// CATALOG: command-string policy) nor check-doc-style.mjs (prose-style lint, not
// CATALOG: package-name correctness). Standalone because the forbidden command
// CATALOG: shape is release-specific and changes independently of link/style policy.
//
// Gate: scan user-facing docs for unscoped install commands and fail. Allows a
// fenced/inline "do-not-use" counter-example marked with the sentinel comment
// `<!-- install-command-allow -->` on the SAME or PRECEDING line, so docs can
// still SHOW the wrong form to warn against it.
//
// Runs in pre-commit (via check-all.mjs L1+) over the tracked user-facing doc set.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// User-facing surfaces a newcomer reads first. Internal/dev docs and the website
// changelog history of the (separate) public package are intentionally out of scope
// only where they reference a different package — but here we scan all of these
// because every one is something a public reader can land on.
const SCAN_PREFIXES = ['README.md', 'website/', 'docs/', '.claude/skills/', 'CONTRIBUTING.md']

// Never scan the gate's own source (it must contain the forbidden patterns to
// describe them) or generated/built site output.
const SKIP_PATHS = [
  'scripts/check-install-command.mjs',
  'website/.vitepress/dist/',
  'website/node_modules/',
]

const SENTINEL = 'install-command-allow'

// Unscoped install invocations. The scoped forms `npx @arbiter/cli` and
// `npm install -g @arbiter/cli` are explicitly allowed (negative lookahead on the
// `@arbiter/cli` package) — only the bare `arbiter` package name is rejected.
const FORBIDDEN = [
  // `npx arbiter ...` but NOT `npx @arbiter/cli ...`
  { re: /\bnpx\s+arbiter\b/, label: 'npx arbiter (use: npx @arbiter/cli)' },
  // `npm install [-g] arbiter` / `npm i [-g] arbiter` / `npm install arbiter@beta`
  // but NOT `... @arbiter/cli`
  {
    re: /\bnpm\s+(?:install|i)\s+(?:-g\s+|--global\s+)?arbiter(?:@[\w.-]+)?\b/,
    label: 'npm install arbiter (use: npm install -g @arbiter/cli)',
  },
]

function shouldScan(filePath) {
  if (SKIP_PATHS.some((skip) => filePath.startsWith(skip))) return false
  if (!filePath.endsWith('.md')) return false
  return SCAN_PREFIXES.some((p) => (p.endsWith('/') ? filePath.startsWith(p) : filePath === p))
}

function getAllTrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    return out.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

try {
  const files = getAllTrackedFiles()
  const violations = []

  for (const file of files) {
    if (!shouldScan(file)) continue
    let content
    try {
      content = readFileSync(join(process.cwd(), file), 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const prev = i > 0 ? lines[i - 1] : ''
      const allowed = line.includes(SENTINEL) || prev.includes(SENTINEL)
      if (allowed) continue
      for (const { re, label } of FORBIDDEN) {
        const m = line.match(re)
        if (m) {
          violations.push({ file, line: i + 1, match: m[0], label })
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      '\n[check-install-command] FAIL — unscoped install command(s) in user-facing docs:\n',
    )
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}: "${v.match}" — ${v.label}`)
    }
    console.error(
      '\nThe published package is @arbiter/cli; the unscoped `arbiter` name is an unrelated\n' +
        'third-party package. Use the scoped form, or mark an intentional counter-example with\n' +
        `an \`<!-- ${SENTINEL} -->\` comment on the same or preceding line.`,
    )
    process.exit(1)
  }

  console.log('[check-install-command] OK — no unscoped install commands in user-facing docs')
} catch (err) {
  process.stderr.write(
    `[check-install-command] unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
