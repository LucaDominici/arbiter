#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-115 enforcement. Extracts hard prohibitions (NEVER / MUST NOT / DO NOT / 🛑 /
// CATALOG: `No <tok>` / `never <tok>`) from free-text governance docs and forces each into one
// CATALOG: honest state — COVERED (mapped to a verified enforcer), ENFORCED-BY-SCAN (derivable
// CATALOG: token, live-grepped every run), or UNENFORCEABLE (triage warn). Extends CANON-09
// CATALOG: (claimed-enforcement = wired-gate) to prose. Rejected fold-in into
// CATALOG: check-inv-enforcement-wired.mjs (that gate matches catalog INV citations, not prose).
// Usage: node scripts/check-constraint-scan.mjs [--docs=a,b] [--src=dir] [--map=path] [--enforce[=true|false]] [--help]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Self-gate default: arbiter HARD-fails on an un-covered derivable prohibition with a live hit.
// The emitted target template renders this `false` (start-warn-promote-later, per #1214).
const ENFORCE_DEFAULT = true

const HELP = `Usage: node scripts/check-constraint-scan.mjs [options]

Extracts hard prohibitions from governance docs and classifies each:
  COVERED          — mapped to an existing, verified enforcer (gate/hook/inv/lint/template)
  ENFORCED-BY-SCAN — derivable code token, live-grepped against --src every run
  UNENFORCEABLE    — prose / path / non-code token → human triage (warn)
A map entry naming a non-existent enforcer is MAP-FICTION and always fails.

Options:
  --docs=<a,b,c>   Comma-separated governance docs (default: AGENTS.md,docs/internal/SYSTEM/CANON.md,.claude/CLAUDE.md)
  --src=<dir>      Source root to scan for live hits (default: src)
  --map=<path>     Constraint map JSON (default: scripts/constraint-map.json)
  --enforce[=bool] Hard-fail on ENFORCED-BY-SCAN live hits (default: ${ENFORCE_DEFAULT})
  --help, -h       Show this help and exit
`

function parseArgs(argv) {
  const get = (name) => {
    const flag = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
    if (!flag) return undefined
    const eq = flag.indexOf('=')
    return eq === -1 ? '' : flag.slice(eq + 1)
  }
  const docs = get('docs')
  const src = get('src')
  const map = get('map')
  const enforceRaw = get('enforce')
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    docs: docs
      ? docs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : ['AGENTS.md', 'docs/internal/SYSTEM/CANON.md', '.claude/CLAUDE.md'],
    src: src || 'src',
    map: map || 'scripts/constraint-map.json',
    enforce: enforceRaw === undefined ? ENFORCE_DEFAULT : enforceRaw !== 'false',
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Extraction ──────────────────────────────────────────────────────────────
// A directive prohibition is a line (or a bullet inside a `**Never:**`/`**Don't:**` block)
// that bans something. Explanatory fields (**Why:**/**Source/**Enforcement) and blockquotes
// are NOT prohibitions. `\bnever\b` is word-bounded so "whenever" never triggers.
const NEVER_BLOCK_HEADER = /^\s*\*\*(Never|Don't|Do ?not)\b[^*]*\*\*\s*$/i
const EXCLUDED_FIELD = /^\s*(>|\*\*(Why|Source|Sources|Enforcement|Promoted|Tradeoff)\b)/i
const BULLET = /^\s*[-*]\s+/
// Inline markers, in scan order. Each captures the slice AFTER the marker for token derivation.
const INLINE_MARKERS = [
  /MUST\s+NOT\b/i,
  /MUST\s+NEVER\b/i,
  /DO\s+NOT\b/i,
  /🛑/,
  /^\s*[-*]?\s*No\s+(?=`)/, // lead `No \`tok\``
  /\bnever\b/i,
]

function tokensIn(text) {
  const out = []
  const re = /`([^`]+)`/g
  let m
  while ((m = re.exec(text))) out.push(m[1])
  return out
}

// Every backtick token AFTER the marker is a prohibited symbol — `MUST NOT use `a` or `b``
// bans both. Tokens BEFORE the marker (e.g. the approved wrapper in "use `x`, never `y`") are
// excluded by construction. Returns [] when no token follows (→ UNENFORCEABLE).
function tokensAfter(line, markerRe) {
  const m = markerRe.exec(line)
  if (!m) return []
  return tokensIn(line.slice(m.index + m[0].length))
}

// Returns [{ doc, line, text, token }] — token may be null (→ UNENFORCEABLE).
function extractProhibitions(docPath, body) {
  const lines = body.split('\n')
  const out = []
  let inBlock = false
  let blockHasBullet = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (NEVER_BLOCK_HEADER.test(line)) {
      inBlock = true
      blockHasBullet = false
      continue
    }
    if (inBlock) {
      if (line.trim() === '') {
        if (blockHasBullet) inBlock = false
        continue
      }
      if (BULLET.test(line)) {
        blockHasBullet = true
        let toks = []
        let markerFound = false
        for (const marker of INLINE_MARKERS) {
          if (marker.test(line)) {
            toks = tokensAfter(line, marker)
            markerFound = true
            break
          }
        }
        if (!markerFound) toks = tokensIn(line)
        if (toks.length === 0)
          out.push({ doc: docPath, line: i + 1, text: line.trim(), token: null })
        else
          for (const tk of toks)
            out.push({ doc: docPath, line: i + 1, text: line.trim(), token: tk })
        continue
      }
      inBlock = false
      // fall through to inline processing for this non-bullet line
    }
    if (EXCLUDED_FIELD.test(line)) continue
    for (const marker of INLINE_MARKERS) {
      if (marker.test(line)) {
        const toks = tokensAfter(line, marker)
        if (toks.length === 0)
          out.push({ doc: docPath, line: i + 1, text: line.trim(), token: null })
        else
          for (const tk of toks)
            out.push({ doc: docPath, line: i + 1, text: line.trim(), token: tk })
        break
      }
    }
  }
  return out
}

// ─── Token-shape filter ──────────────────────────────────────────────────────
// Only true code symbols are derivable (grep-able). Paths, commands, file names, kebab
// tokens, bare English words (const/let/proven/main/unknown), and <3-char tokens (L1) are
// UNENFORCEABLE — surfacing them as warnings instead of reddening the gate on noise.
const DERIVABLE_KEYWORDS = new Set(['var', 'any', 'eval'])
function isDerivable(tok) {
  const t = tok.trim()
  if (DERIVABLE_KEYWORDS.has(t)) return true
  if (t.length < 3) return false
  if (t.includes('/')) return false // path
  if (/\.(json|mjs|cjs|ts|tsx|js|jsx|md|txt|ya?ml|toml|lock)\b/i.test(t)) return false // file
  if (/\s/.test(t)) return false // command / phrase
  if (t.includes('(')) return true // call or method: fetch(), .unwrap()
  if (/[_]/.test(t) || /[A-Z]/.test(t)) {
    if (t.includes('-')) return false // kebab (Tier-1, --no-verify)
    return true // ArbiterError, child_process
  }
  return false // plain lowercase word
}

function tokenToRegExp(tok) {
  const esc = escapeRegExp(tok)
  // pure identifier → word-bound; call/member tokens are specific enough escaped literally
  return /^[A-Za-z_$][\w$]*$/.test(tok) ? new RegExp(`\\b${esc}\\b`) : new RegExp(esc)
}

// ─── Enforcer existence verification (anti-fiction, CANON-23) ─────────────────
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
let scanIncomplete = false
function walk(dir, acc) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (err) {
    process.stderr.write(`[SCAN-INCOMPLETE] cannot read dir ${dir}: ${err.message}\n`)
    scanIncomplete = true
    return acc
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git' || e === 'dist' || e === 'coverage') continue
    const full = join(dir, e)
    let st
    try {
      st = statSync(full)
    } catch (err) {
      process.stderr.write(`[SCAN-INCOMPLETE] cannot stat ${full}: ${err.message}\n`)
      scanIncomplete = true
      continue
    }
    if (st.isDirectory()) walk(full, acc)
    else if (CODE_EXT.test(e)) acc.push(full)
  }
  return acc
}

function enforcerExists(enforcer, kind, root) {
  switch (kind) {
    case 'hook':
      return existsSync(join(root, '.claude/hooks', enforcer))
    case 'script':
      return existsSync(join(root, 'scripts', enforcer))
    case 'gate': {
      const gate = join(root, 'scripts/check-all.mjs')
      return existsSync(gate) && readFileSync(gate, 'utf8').includes(enforcer)
    }
    case 'inv': {
      const cat = join(root, 'src/invariants/catalog.ts')
      return existsSync(cat) && readFileSync(cat, 'utf8').includes(enforcer)
    }
    case 'lint': {
      // Require the rule to be ACTIVE (error/2), not merely present — a disabled rule
      // (`"no-var": "off"`) must not read as COVERED. Works for both JSON (.eslintrc*) and
      // flat-config (eslint.config.js) since both spell it `<rule>: 'error'` / `: 2` / `['error'`.
      const configs = readdirSync(root).filter(
        (f) => /eslint/i.test(f) && /\.(json|js|cjs|mjs|yaml|yml)$/i.test(f),
      )
      const activeRe = new RegExp(
        `${escapeRegExp(enforcer)}["']?\\s*[:=]\\s*\\[?\\s*["']?(error|2)\\b`,
      )
      return configs.some((c) => {
        try {
          return activeRe.test(readFileSync(join(root, c), 'utf8'))
        } catch {
          return false
        }
      })
    }
    case 'template':
      return existsSync(join(root, enforcer))
    default:
      return false
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    process.exit(0)
  }
  const root = process.cwd()

  // #2037: explicit, visible opt-out — governance.constraintScan:"off" in arbiter.json
  // skips the whole gate. Unreadable arbiter.json is a schema error (INV-96 fail-closed),
  // not silently ignored — mirrors check-render-smoke.mjs's ERROR/exit(2) contract.
  const arbiterJsonPath = resolve(root, 'arbiter.json')
  if (existsSync(arbiterJsonPath)) {
    let arbiterCfg
    try {
      arbiterCfg = JSON.parse(readFileSync(arbiterJsonPath, 'utf8'))
    } catch (err) {
      process.stderr.write(`[check-constraint-scan] invalid arbiter.json: ${err.message}\n`)
      process.exit(2)
    }
    if (arbiterCfg?.governance?.constraintScan === 'off') {
      process.stdout.write(
        '[check-constraint-scan] SKIP — governance.constraintScan is "off" in arbiter.json\n',
      )
      // #2052: recognized marker so runCheck surfaces SKIP, not PASS, in the gate summary.
      process.stdout.write('[SKIP] governance.constraintScan is "off" in arbiter.json\n')
      process.exit(0)
    }
  }

  // Load map. #2037: a MISSING map file fails closed — the gate declares coverage against
  // it, so absent linking data must never read as compliant. A PRESENT-but-empty map still
  // warns (unchanged): a fresh project curates coverage over time, it starts empty by design.
  let map = {}
  const mapPath = resolve(root, args.map)
  if (existsSync(mapPath)) {
    try {
      map = JSON.parse(readFileSync(mapPath, 'utf8'))
    } catch (err) {
      process.stderr.write(`[constraint-scan] invalid map JSON at ${mapPath}: ${err.message}\n`)
      process.exit(2)
    }
    // Shape-valid JSON is not schema-valid: an array/string/number/null parses fine
    // but is not a token→{enforcer,kind} object — silently treating it as an empty
    // map would be indistinguishable from a legitimately-curated empty {} map.
    if (map === null || typeof map !== 'object' || Array.isArray(map)) {
      process.stderr.write(
        `[constraint-scan] invalid map JSON at ${mapPath}: expected an object, got ` +
          `${Array.isArray(map) ? 'array' : map === null ? 'null' : typeof map}\n`,
      )
      process.exit(2)
    }
    // "//"-prefixed keys are documentation comments (the scaffolded starter map uses
    // them), never real tokens — strip them before validation so a self-documenting
    // map isn't rejected as schema-invalid, and before any lookup so a doc key can
    // never collide with an extracted token.
    map = Object.fromEntries(Object.entries(map).filter(([key]) => !key.startsWith('//')))
    for (const [tok, entry] of Object.entries(map)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        process.stderr.write(
          `[constraint-scan] invalid map JSON at ${mapPath}: entry "${tok}" must be an ` +
            `object with enforcer/kind, got ${entry === null ? 'null' : typeof entry}\n`,
        )
        process.exit(2)
      }
    }
  } else {
    process.stderr.write(
      `[check-constraint-scan] FAIL — ${args.map} missing; run \`arbiter update\` to scaffold it, ` +
        `or set governance.constraintScan:"off" in arbiter.json\n`,
    )
    process.exit(1)
  }

  // Extract from every present doc.
  const prohibitions = []
  let docsScanned = 0
  for (const d of args.docs) {
    const p = resolve(root, d)
    if (!existsSync(p)) continue
    docsScanned++
    prohibitions.push(...extractProhibitions(d, readFileSync(p, 'utf8')))
  }

  // Fail-closed against vacuous green: a constraint gate that finds NO governance docs is
  // misconfigured, not compliant. Zero docs found must never read as "all prohibitions enforced".
  if (docsScanned === 0) {
    process.stderr.write(
      `[check-constraint-scan] no governance docs found (looked for: ${args.docs.join(', ')}) — misconfigured\n`,
    )
    process.exit(1)
  }

  // Lazily scan source only when a derivable, un-covered token needs a live check.
  let srcFiles = null
  const srcRoot = resolve(root, args.src)
  function liveHit(tok) {
    if (srcFiles === null) srcFiles = existsSync(srcRoot) ? walk(srcRoot, []) : []
    const re = tokenToRegExp(tok)
    for (const f of srcFiles) {
      let content
      try {
        content = readFileSync(f, 'utf8')
      } catch (err) {
        process.stderr.write(`[SCAN-INCOMPLETE] cannot read ${f}: ${err.message}\n`)
        scanIncomplete = true
        continue
      }
      if (re.test(content)) return f.startsWith(root) ? f.slice(root.length + 1) : f
    }
    return null
  }

  let fiction = 0
  let violations = 0
  const seenCovered = new Set()
  const seenUnenf = new Set()

  for (const pr of prohibitions) {
    const tok = pr.token
    if (tok && Object.prototype.hasOwnProperty.call(map, tok)) {
      const { enforcer, kind } = map[tok]
      if (enforcerExists(enforcer, kind, root)) {
        if (!seenCovered.has(tok)) {
          process.stdout.write(`[COVERED] ${tok} → ${kind}:${enforcer}\n`)
          seenCovered.add(tok)
        }
      } else {
        process.stdout.write(
          `[MAP-FICTION] ${tok} → ${kind}:${enforcer} (enforcer not found) — ${pr.doc}:${pr.line}\n`,
        )
        fiction++
      }
      continue
    }
    if (tok && isDerivable(tok)) {
      const hit = liveHit(tok)
      if (hit) {
        if (args.enforce) {
          process.stdout.write(`[VIOLATION] ${tok} @ ${hit} (prohibited by ${pr.doc}:${pr.line})\n`)
          violations++
        } else {
          process.stdout.write(`[WARN-SCAN] ${tok} @ ${hit} (prohibited by ${pr.doc}:${pr.line})\n`)
        }
      }
      // no hit → the scan itself IS the wiring; nothing to report.
      continue
    }
    // token null, or non-code token → human triage.
    const sig = tok || pr.text.slice(0, 60)
    if (!seenUnenf.has(sig)) {
      process.stdout.write(`[UNENFORCEABLE] ${sig} — ${pr.doc}:${pr.line}\n`)
      seenUnenf.add(sig)
    }
  }

  if (fiction > 0) {
    process.stdout.write(`[check-constraint-scan] FAIL: ${fiction} map-fiction entry(ies)\n`)
    process.exit(1)
  }
  if (violations > 0) {
    process.stdout.write(
      `[check-constraint-scan] FAIL: ${violations} unenforced prohibition violation(s)\n`,
    )
    process.exit(1)
  }
  if (scanIncomplete && args.enforce) {
    process.stdout.write(
      '[check-constraint-scan] FAIL: scan incomplete — some source files could not be read\n',
    )
    process.exit(1)
  }
  process.stdout.write(
    `[check-constraint-scan] OK — ${docsScanned} doc(s), ${prohibitions.length} prohibition(s): ` +
      `${seenCovered.size} covered, ${seenUnenf.size} unenforceable (triage)\n`,
  )
  process.exit(0)
}

try {
  main()
} catch (err) {
  // Fail-closed (INV-96): an unexpected error must block, never silently pass.
  process.stderr.write(
    `[check-constraint-scan] unexpected error: ${err instanceof Error ? err.stack : String(err)}\n`,
  )
  process.exit(1)
}
