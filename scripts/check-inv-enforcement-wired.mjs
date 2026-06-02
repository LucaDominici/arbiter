#!/usr/bin/env node
// INV-52: Every enforcement script cited in catalog must be wired in check-all.mjs (CANON-09).
// Usage: node scripts/check-inv-enforcement-wired.mjs [--catalog=path] [--gate=path]
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const catalogArg = args.find((a) => a.startsWith('--catalog='))
const gateArg = args.find((a) => a.startsWith('--gate='))

const root = process.cwd()
const catalogPath = catalogArg
  ? resolve(catalogArg.split('=')[1])
  : resolve(root, 'src/invariants/catalog.ts')
const gatePath = gateArg ? resolve(gateArg.split('=')[1]) : resolve(root, 'scripts/check-all.mjs')

const catalogSrc = readFileSync(catalogPath, 'utf-8')
const gateSrc = readFileSync(gatePath, 'utf-8')

// Track-B scripts: generated into governed target projects, NOT run as arbiter self-gates.
// Citing them in catalog enforcement fields is correct documentation; their absence from
// arbiter's own check-all.mjs is expected and is not a violation.
const TRACK_B_EXEMPT = new Set([
  'verify-i18n-parity.mjs', // INV-106: emitted by frontend generator for FE target projects
  'i18n-literal-scanner.mjs', // INV-106: emitted by frontend generator for FE target projects
  'verify-tokens.mjs', // INV-105: emitted by frontend generator for FE target projects
  'verify-spotbugs.mjs', // INV-44: emitted by Java template for Java target projects
  'debt-lib.mjs', // INV-109: shared library helper, not a standalone gate step
  'done-evidence.mjs', // INV-38: generated evidence-capture CLI for target projects (.ejs)
  'evidence-collect.mjs', // INV-33: generated nightly-pipeline harness for target projects
])

// Match scripts/<name>.mjs — broadened to all prefix patterns and digits.
// Negative lookahead (?!\.ejs) prevents matching the .mjs part inside .mjs.ejs template refs.
const scriptRefs = [...catalogSrc.matchAll(/scripts\/([a-z][a-z0-9-]+\.mjs)(?!\.ejs)/g)].map(
  (m) => m[1],
)
const uniqueScripts = [...new Set(scriptRefs)].filter(
  (s) => s !== 'check-all.mjs' && !TRACK_B_EXEMPT.has(s),
)

let violations = 0
for (const script of uniqueScripts) {
  if (!gateSrc.includes(script)) {
    process.stdout.write(`  MISSING from check-all.mjs: ${script}\n`)
    violations++
  }
}

// #1153: close the blind spot for hook-style enforcement citations. The catalog
// also cites enforcement as bare parenthesised filenames — e.g. `hook
// (check-no-orphan-todo.mjs)` — which carry no `scripts/` prefix and so were
// invisible to the wiring check above. These run via .claude hooks, not
// check-all.mjs, so the correct validation is existence: a citation to a script
// that does not exist as a hook (or script) is fiction enforcement.
const hookRefs = [...catalogSrc.matchAll(/\(([a-z][a-z0-9-]+\.mjs)\)(?!\.ejs)/g)].map((m) => m[1])
const uniqueHooks = [...new Set(hookRefs)].filter(
  (s) => !uniqueScripts.includes(s) && s !== 'check-all.mjs' && !TRACK_B_EXEMPT.has(s),
)
for (const hook of uniqueHooks) {
  const existsAsHook = existsSync(resolve(root, '.claude/hooks', hook))
  const existsAsScript = existsSync(resolve(root, 'scripts', hook))
  if (!existsAsHook && !existsAsScript) {
    process.stdout.write(
      `  CITED hook does not exist (.claude/hooks/ or scripts/): ${hook}\n`,
    )
    violations++
  }
}

if (violations > 0) {
  process.stdout.write(
    `[check-inv-enforcement-wired] FAIL: ${violations} enforcement script(s) not wired/found\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `[check-inv-enforcement-wired] OK — ${uniqueScripts.length} gate scripts wired, ${uniqueHooks.length} hook citations verified\n`,
)
