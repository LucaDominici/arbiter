#!/usr/bin/env node
// INV-52: Every enforcement script cited in catalog must be wired in check-all.mjs (CANON-09).
// Usage: node scripts/check-inv-enforcement-wired.mjs [--catalog=path] [--gate=path]
//                                                     [--generators=dir]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const catalogArg = args.find((a) => a.startsWith('--catalog='))
const gateArg = args.find((a) => a.startsWith('--gate='))
const generatorsArg = args.find((a) => a.startsWith('--generators='))

const root = process.cwd()
const catalogPath = catalogArg
  ? resolve(catalogArg.split('=')[1])
  : resolve(root, 'src/invariants/catalog.ts')
const gatePath = gateArg ? resolve(gateArg.split('=')[1]) : resolve(root, 'scripts/check-all.mjs')
const generatorsPath = generatorsArg
  ? resolve(generatorsArg.split('=')[1])
  : resolve(root, 'src/generators')

const catalogSrc = readFileSync(catalogPath, 'utf-8')
const gateSrc = readFileSync(gatePath, 'utf-8')

// Track-B scripts: generated into governed target projects, NOT run as arbiter self-gates.
// Citing them in catalog enforcement fields is correct documentation; their absence from
// arbiter's own check-all.mjs is expected and is not a violation.
// #2278: "generated for target projects" is a CLAIM, and every entry below is now
// VERIFIED against src/generators/ by the emission pass at the bottom of this file.
// It was unverified until evidence-collect.mjs turned out to be emitted by nobody
// while INV-33 cited it as enforcement — a promise nothing kept, invisible precisely
// BECAUSE the exemption suppressed it.
const TRACK_B_EXEMPT = new Set([
  'verify-i18n-parity.mjs', // INV-106: emitted by frontend generator for FE target projects
  'i18n-literal-scanner.mjs', // INV-106: emitted by frontend generator for FE target projects
  'verify-tokens.mjs', // INV-105: emitted by frontend generator for FE target projects
  'verify-spotbugs.mjs', // INV-44: emitted by Java template for Java target projects
  'debt-lib.mjs', // INV-109: shared library helper, not a standalone gate step
  'done-evidence.mjs', // INV-38: generated evidence-capture CLI for target projects (.ejs)
  'evidence-collect.mjs', // INV-33: generated nightly-pipeline harness for target projects
  'check-stack-conformity.mjs', // INV-121: emitted by check-stack-conformity.ts for target projects (#1312)
  'check-e2e-quarantine.mjs', // INV-130: emitted E2E reliability quarantine gate for target projects (#1445)
  'check-tdd-evidence.mjs', // INV-131: emitted TDD-evidence re-verification gate for target projects (#1446)
  'verify-module-coverage.mjs', // INV-134: emitted per-module coverage ratchet (advisory) for target projects (#1457)
  // Track-B workflow/FE gates: generated from src/templates/scripts/*.mjs.ejs into target
  // projects, never run as arbiter self-gates. Newly subtracted (#1664) because the
  // position-agnostic check-* existence pass below would otherwise flag them.
  'check-fe-boundaries.mjs', // INV-102..104: emitted by the check-all generator for FE target projects (#1127)
  'check-workflow-perms.mjs', // INV-77: emitted workflow least-privilege gate for target projects
  'check-workflow-job-naming.mjs', // INV-89: Track-B-only workflow job-naming gate for target projects
  'check-workflow-sha-pinning.mjs', // INV-89: Track-B-only workflow SHA-pinning gate for target projects
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
    process.stdout.write(`  CITED hook does not exist (.claude/hooks/ or scripts/): ${hook}\n`)
    violations++
  }
}

// #1664: close the inverse-citation blind spot. Hooks are also cited with the
// filename OUTSIDE the parens, the parens carrying trigger context — e.g.
// `Claude hook: check-no-pii.mjs (PostToolUse, Edit|Write)`. Such a citation has
// no `scripts/` prefix and no parenthesised filename, so it escaped BOTH passes
// above; a future typo or deleted hook in this already-in-use style would pass
// undetected. Scan position-agnostic for every cited gate-style `check-*.mjs`
// (case-insensitive — names are conventionally lowercase, but fold case so an
// uppercase typo cannot slip through), subtract the names already validated by
// the wiring/paren passes plus the always-present check-all.mjs and the Track-B
// generated gates, then assert each remaining name exists as a hook or script.
const checkRefs = [...catalogSrc.matchAll(/(check-[a-z0-9-]+\.mjs)(?!\.ejs)/gi)].map((m) =>
  m[1].toLowerCase(),
)
const uniqueChecks = [...new Set(checkRefs)].filter(
  (s) =>
    !uniqueScripts.includes(s) &&
    !uniqueHooks.includes(s) &&
    s !== 'check-all.mjs' &&
    !TRACK_B_EXEMPT.has(s),
)
for (const name of uniqueChecks) {
  const existsAsHook = existsSync(resolve(root, '.claude/hooks', name))
  const existsAsScript = existsSync(resolve(root, 'scripts', name))
  if (!existsAsHook && !existsAsScript) {
    process.stdout.write(`  CITED hook does not exist (.claude/hooks/ or scripts/): ${name}\n`)
    violations++
  }
}

// #2278: an exemption is only legitimate while a generator really emits the script.
// Verify each claim against src/generators/: the name must appear as an EXACT quoted
// literal, either the renderTemplate path `scripts/<name>.ejs` or the bare `<name>`
// used by the name-list emission loops. Exact-literal, never substring — a prose
// mention in a comment is the same unverified assertion this pass exists to kill.
function emissionLiterals(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return new Set() // unreadable generators dir ⇒ nothing proven (fail closed)
  }
  const literals = new Set()
  for (const file of entries) {
    if (!file.endsWith('.ts')) continue
    let src
    try {
      src = readFileSync(join(dir, file), 'utf-8')
    } catch {
      continue
    }
    for (const m of src.matchAll(/(['"`])([^'"`\n]*)\1/g)) literals.add(m[2])
  }
  return literals
}

const literals = emissionLiterals(generatorsPath)
for (const name of TRACK_B_EXEMPT) {
  if (literals.has(name) || literals.has(`scripts/${name}.ejs`)) continue
  process.stdout.write(`  EXEMPT but emitted by no generator: ${name}\n`)
  violations++
}

if (violations > 0) {
  process.stdout.write(
    `[check-inv-enforcement-wired] FAIL: ${violations} enforcement script(s) not wired/found\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `[check-inv-enforcement-wired] OK — ${uniqueScripts.length} gate scripts wired, ` +
    `${uniqueHooks.length} paren-cited + ${uniqueChecks.length} bare check-* hook citations verified, ` +
    `${TRACK_B_EXEMPT.size} exemptions proven emitted\n`,
)
