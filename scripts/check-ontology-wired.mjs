#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: the anti-prose meta-gate. Enumerates every scheme in docs/internal/SYSTEM/ID-REGISTRY.md
// CATALOG: and proves each one is a WIRED behaviour rather than a described one: its gate script is
// CATALOG: registered on the side its `track` names (scripts/check-all.mjs for self, the declarative
// CATALOG: src/templates/scripts/gate-registry.yml.ejs for target), its `tool` verb resolves in
// CATALOG: src/cli.ts, and its `hook` is registered in .claude/settings.json. Carries a monotone
// CATALOG: ratchet over the unwired legs, so the number of schemes that exist only on paper can
// CATALOG: fall but never quietly rise.
// CATALOG: rejected fold-in into check-id-registry.mjs because that gate proves the registry is
// CATALOG: WELL-FORMED (schema, collisions, resolvable citations) and must pass before wiring can be
// CATALOG: assessed at all; merging them would report a malformed row and an unwired row as the same
// CATALOG: class of failure and make the ratchet uninterpretable.
// CATALOG: rejected fold-in into check-inv-enforcement-wired.mjs because that gate walks the INVARIANT
// CATALOG: catalog (enforcement citation -> check-all wiring) for one scheme; this walks EVERY scheme
// CATALOG: and additionally demands a tool surface and an edit-time hook, which INV-52 never asks for.
//
// scripts/check-ontology-wired.mjs
// L1 gate: no artifact type in the ontology may exist as documentation alone.
//
// For each `active` scheme:
//   1. gate     — the script is registered where its track says it runs,
//   2. tool     — every verb token after `arbiter ` resolves to a .command() in src/cli.ts,
//   3. hook     — the file exists and its basename is registered in the settings it applies to.
// `staged` rows are exempt from 1-3 by design — a stage is a dated obligation, enforced by
// check-id-registry.mjs, not a second copy of the same failure here. They are COUNTED instead,
// and the ratchet is what stops staging from becoming a parking lot.
//
// Usage: node scripts/check-ontology-wired.mjs [--dir <repo>] [--update-baseline]
// There is deliberately no --allow-increase: growth is legitimised by hand-editing
// scripts/data/ontology-baseline.json in the same PR as the row that caused it, where the raised
// number lands in the diff next to its justification.
// Exit: 0 pass, 1 violation, 2 error (INV-53).
//
// Exports for unit tests: verbTokens, gateWiredIn, countUnwired

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractJsonBlock } from './check-id-registry.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const REGISTRY_REL = join('docs', 'internal', 'SYSTEM', 'ID-REGISTRY.md')
const SELF_GATE_ROSTER = join('scripts', 'check-all.mjs')
const TARGET_GATE_ROSTER = join('src', 'templates', 'scripts', 'gate-registry.yml.ejs')
const CLI_REL = join('src', 'cli.ts')
const SELF_SETTINGS = join('.claude', 'settings.json')
const TARGET_SETTINGS = join('src', 'templates', 'claude', 'settings.json.ejs')
const BASELINE_REL = join('scripts', 'data', 'ontology-baseline.json')

/**
 * The verbs a `tool` string claims, e.g. `arbiter graph build` -> ['graph', 'build'].
 * A tool that does not start with `arbiter ` is not a CLI surface and cannot be checked.
 */
export function verbTokens(tool) {
  const parts = tool.trim().split(/\s+/)
  if (parts[0] !== 'arbiter' || parts.length < 2) return null
  return parts.slice(1).filter((p) => !p.startsWith('-'))
}

/** Whether a roster file registers a gate script, matched on basename to survive path style. */
export function gateWiredIn(rosterText, gatePath) {
  return rosterText.includes(basename(gatePath))
}

/** Ratchet counters: how much of the ontology is not yet behaviour. */
export function countUnwired(schemes) {
  const counts = { staged: 0, naGate: 0, naTool: 0, naHook: 0 }
  for (const s of schemes) {
    if (s.status === 'staged') counts.staged += 1
    if (s.gate === 'n/a') counts.naGate += 1
    if (s.tool === 'n/a') counts.naTool += 1
    if (s.hook === 'n/a') counts.naHook += 1
  }
  return counts
}

function readIfPresent(path) {
  try {
    return readFileSync(path, 'utf-8')
    // FAIL-OPEN-INTENT: an absent roster/settings file becomes null and is reported as an unwired leg by the caller — a missing file IS the finding, not an error.
  } catch {
    return null
  }
}

/** Read the registry block, or an exit code describing why it could not be read. */
function loadSchemes(root) {
  const registryPath = join(root, REGISTRY_REL)
  if (!existsSync(registryPath)) {
    process.stderr.write(`check-ontology-wired: ERROR — ${REGISTRY_REL} not found under ${root}\n`)
    return { code: 2 }
  }
  const block = extractJsonBlock(readFileSync(registryPath, 'utf-8'), 'ID_REGISTRY')
  if (!block.ok) {
    process.stderr.write(`check-ontology-wired: ERROR — ${REGISTRY_REL}: ${block.error}\n`)
    return { code: 2 }
  }
  const schemes = Array.isArray(block.value?.schemes) ? block.value.schemes : []
  if (schemes.length === 0) {
    process.stderr.write(`check-ontology-wired: ERROR — registry declares no schemes\n`)
    return { code: 2 }
  }
  return { schemes }
}

/** The five files a wiring verdict is read from. */
function loadSurfaces(root) {
  return {
    selfRoster: readIfPresent(join(root, SELF_GATE_ROSTER)) ?? '',
    targetRoster: readIfPresent(join(root, TARGET_GATE_ROSTER)) ?? '',
    cli: readIfPresent(join(root, CLI_REL)) ?? '',
    selfSettings: readIfPresent(join(root, SELF_SETTINGS)) ?? '',
    targetSettings: readIfPresent(join(root, TARGET_SETTINGS)) ?? '',
  }
}

/** Leg 1: the gate script is registered on the side the row's track names. */
function gateViolations(s, where, wants, surfaces) {
  if (s.gate === 'n/a') return []
  const out = []
  if (wants.self && !gateWiredIn(surfaces.selfRoster, s.gate)) {
    out.push(
      `${where}: gate ${s.gate} is declared track "${s.track}" but is not registered in ` +
        `${SELF_GATE_ROSTER} — a gate nothing runs is documentation`,
    )
  }
  if (wants.target && !gateWiredIn(surfaces.targetRoster, s.gate)) {
    out.push(
      `${where}: gate ${s.gate} is declared track "${s.track}" but is not registered in ` +
        `${TARGET_GATE_ROSTER} — governed projects would never run it (CANON-01)`,
    )
  }
  return out
}

/** Leg 2: every verb the tool names resolves to a .command() in the CLI. */
function toolViolations(s, where, cli) {
  if (s.tool === 'n/a') return []
  const tokens = verbTokens(s.tool)
  if (tokens === null) return [`${where}: tool "${s.tool}" is not an \`arbiter <verb>\` surface`]
  return tokens
    .filter((token) => !cli.includes(`.command('${token}'`) && !cli.includes(`.command('${token} `))
    .map((token) => `${where}: tool "${s.tool}" names verb "${token}", absent from ${CLI_REL}`)
}

/** Leg 3: the hook exists AND is registered — an unregistered hook never fires. */
function hookViolations(s, where, wants, root, surfaces) {
  if (s.hook === 'n/a') return []
  if (!existsSync(join(root, s.hook))) return [`${where}: hook ${s.hook} does not exist`]
  const hookName = basename(s.hook)
  const out = []
  if (wants.self && !surfaces.selfSettings.includes(hookName)) {
    out.push(
      `${where}: hook ${hookName} exists but is not registered in ${SELF_SETTINGS} — ` +
        `an unregistered hook never fires`,
    )
  }
  if (wants.target && !surfaces.targetSettings.includes(hookName)) {
    out.push(
      `${where}: hook ${hookName} is not registered in ${TARGET_SETTINGS} (CANON-10/CANON-14)`,
    )
  }
  return out
}

/** The ratchet: an unwired count may fall freely and may never quietly rise. */
function ratchetViolations(counts, baseline) {
  const out = []
  for (const key of Object.keys(counts)) {
    const allowed = baseline[key]
    if (typeof allowed !== 'number') {
      out.push(`${BASELINE_REL}: missing counter "${key}"`)
      continue
    }
    if (counts[key] > allowed) {
      out.push(
        `ratchet: ${key} rose to ${counts[key]}, baseline allows ${allowed} — ` +
          `the ontology grew a leg that is described but not wired`,
      )
    }
  }
  return out
}

function writeBaseline(baselinePath, baseline, counts) {
  const regressions = Object.keys(counts).filter((k) => counts[k] > (baseline[k] ?? 0))
  if (regressions.length > 0) {
    process.stderr.write(
      `check-ontology-wired: refusing --update-baseline — ${regressions.join(', ')} increased. ` +
        `Raise the number by hand, in the same PR as the row that needs it.\n`,
    )
    return 1
  }
  writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, ...counts }, null, 2)}\n`)
  process.stdout.write(`check-ontology-wired: baseline updated — ${JSON.stringify(counts)}\n`)
  return 0
}

/** Every ACTIVE row's three legs. Staged rows are INV-140's business, not this gate's. */
function wiringViolations(schemes, root, surfaces) {
  const out = []
  for (const s of schemes) {
    if (s.status !== 'active') continue
    const where = `scheme "${s.prefix}"`
    const wants = {
      self: s.track === 'self' || s.track === 'both',
      target: s.track === 'target' || s.track === 'both',
    }
    out.push(
      ...gateViolations(s, where, wants, surfaces),
      ...toolViolations(s, where, surfaces.cli),
      ...hookViolations(s, where, wants, root, surfaces),
    )
  }
  return out
}

/** The ratchet file, or an exit code describing why it could not be read. */
function loadBaseline(baselinePath) {
  const raw = readIfPresent(baselinePath)
  if (raw === null) {
    process.stderr.write(`check-ontology-wired: ERROR — ${BASELINE_REL} not found\n`)
    return { code: 2 }
  }
  try {
    return { baseline: JSON.parse(raw) }
  } catch (err) {
    process.stderr.write(`check-ontology-wired: ERROR — ${BASELINE_REL}: ${err.message}\n`)
    return { code: 2 }
  }
}

function main() {
  const argv = process.argv.slice(2)
  const dirIdx = argv.indexOf('--dir')
  const root = dirIdx === -1 ? resolve(scriptDir, '..') : resolve(argv[dirIdx + 1])

  const loaded = loadSchemes(root)
  if (loaded.code !== undefined) return loaded.code
  const { schemes } = loaded
  const surfaces = loadSurfaces(root)

  const violations = wiringViolations(schemes, root, surfaces)

  const counts = countUnwired(schemes)
  const baselinePath = join(root, BASELINE_REL)
  const loadedBaseline = loadBaseline(baselinePath)
  if (loadedBaseline.code !== undefined) return loadedBaseline.code
  const { baseline } = loadedBaseline

  if (argv.includes('--update-baseline')) return writeBaseline(baselinePath, baseline, counts)
  violations.push(...ratchetViolations(counts, baseline))

  if (violations.length > 0) {
    process.stderr.write(`check-ontology-wired: FAIL — ${violations.length} violation(s)\n`)
    for (const v of violations) process.stderr.write(`  - ${v}\n`)
    return 1
  }
  const active = schemes.filter((s) => s.status === 'active').length
  process.stdout.write(
    `check-ontology-wired: PASS — ${active} active schemes wired, ${counts.staged} staged ` +
      `(baseline ${baseline.staged})\n`,
  )
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main())
  } catch (err) {
    process.stderr.write(`check-ontology-wired: ERROR — unexpected: ${err.message}\n`)
    process.exit(1)
  }
}
