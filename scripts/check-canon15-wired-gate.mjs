#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/check-canon15-wired-gate.mjs
//
// CANON-15 (#1923, ACTION_PLAN.md Tranche B3/FP-3): emitting a linter config, a
// security-scanner config, or an architecture-boundary config is not sufficient.
// The gate step that INVOKES it must be emitted too — a config file with no gate
// invocation is a paper rule, since no CI runner enforces it.
//
// This promotes the rule from prose ("checked at PR review") to a machine check,
// under the CANON-parity gate's dated promotion `promotion: #1923 by 2026-08-29`.
// CANON-02 machine-checks the narrower compatibility-matrix `proven`-cell case;
// this is the general case across the artifact classes.
//
// Scope = the three CANON-15 artifact-class directories:
//   src/templates/boundaries/      architecture-boundary configs
//   src/templates/static-analysis/ linter / formatter / dead-code configs
//   src/templates/security/        security-scanner configs
// Directory-scoped discovery (rather than a hand-listed set of config filenames)
// is what keeps the gate self-extending: a NEW template dropped into one of those
// directories is undeclared and FAILS, forcing the emit-a-gate-step decision that
// CANON-15 asks for. A filename-pattern approach would silently ignore the next
// tool whose config shape nobody predicted.
//
// Every discovered template must be declared in scripts/canon15-config-gates.json:
//   { "template": "<dir>/<file>.ejs", "gate": "<gate-registry id>" }   gated
//   { "template": "...", "gate": null, "reason": "..." }               reasoned no-gate
// A `gate` must resolve to a real `id:` in src/templates/scripts/gate-registry.yml.ejs
// (the declarative registry check-all.mjs is generated from, #2041). A null gate
// needs a reason — a carve-out without one is exactly the paper rule CANON-15 bans.
// A declaration whose template no longer exists FAILs as dead, so the ledger cannot
// rot into a suppression list.
//
// Usage: node scripts/check-canon15-wired-gate.mjs [--root <dir>]
// Exit 0 = every config template is gated or reasoned; 1 = violations.
//
// Exports for unit tests: discoverConfigTemplates, registryGateIds, findViolations
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The CANON-15 artifact classes, as template directories. */
export const CONFIG_TEMPLATE_DIRS = ['boundaries', 'static-analysis', 'security']

const MAP_PATH = 'scripts/canon15-config-gates.json'
const REGISTRY_PATH = 'src/templates/scripts/gate-registry.yml.ejs'

/** Every `.ejs` under the artifact-class directories, as `<dir>/<path>.ejs`. */
export function discoverConfigTemplates(root) {
  const found = []
  for (const dir of CONFIG_TEMPLATE_DIRS) {
    const base = join(root, 'src', 'templates', dir)
    if (!existsSync(base)) continue
    walk(base, dir, found)
  }
  return found.sort()
}

function walk(abs, rel, out) {
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const childAbs = join(abs, entry.name)
    const childRel = `${rel}/${entry.name}`
    if (entry.isDirectory()) walk(childAbs, childRel, out)
    else if (entry.name.endsWith('.ejs')) out.push(childRel)
  }
}

/** Gate ids declared in the registry template (`- { id: <kebab>, ... }`). */
export function registryGateIds(registrySrc) {
  return new Set([...registrySrc.matchAll(/^\s*-\s*\{\s*id:\s*([a-z0-9-]+)/gm)].map((m) => m[1]))
}

export function findViolations(templates, declarations, gateIds) {
  const violations = []
  const declared = new Map(declarations.map((d) => [d.template, d]))

  for (const template of templates) {
    const decl = declared.get(template)
    if (!decl) {
      violations.push(
        `${template}: UNDECLARED — emits a config artifact with no entry in ${MAP_PATH}. ` +
          `Add the gate step that invokes it and map it, or declare gate: null with a reason.`,
      )
      continue
    }
    if (decl.gate === null || decl.gate === undefined) {
      if (typeof decl.reason !== 'string' || decl.reason.trim() === '') {
        violations.push(
          `${template}: no-gate declaration without a reason — an unreasoned carve-out is the paper rule CANON-15 forbids.`,
        )
      }
      continue
    }
    if (!gateIds.has(decl.gate)) {
      violations.push(
        `${template}: declares gate "${decl.gate}", which is in no entry of ${REGISTRY_PATH} — ` +
          `the config is emitted but nothing invokes it.`,
      )
    }
  }

  const present = new Set(templates)
  for (const decl of declarations) {
    if (!present.has(decl.template)) {
      violations.push(`${decl.template}: DEAD declaration — the template no longer exists; remove it.`)
    }
  }
  return violations
}

function parseRoot(argv) {
  const i = argv.indexOf('--root')
  if (i === -1) return defaultRoot
  const value = argv[i + 1]
  if (!value || value.startsWith('--')) throw new Error('missing directory after --root')
  return resolve(value)
}

function main() {
  const root = parseRoot(process.argv.slice(2))
  const mapPath = join(root, MAP_PATH)
  const registryPath = join(root, REGISTRY_PATH)

  // FAIL-CLOSED: a missing ledger or registry is a broken gate, not a pass.
  for (const [path, label] of [
    [mapPath, MAP_PATH],
    [registryPath, REGISTRY_PATH],
  ]) {
    if (!existsSync(path)) {
      process.stderr.write(`[check-canon15-wired-gate] ERROR: ${label} not found under ${root}\n`)
      process.exit(2)
    }
  }

  const declarations = JSON.parse(readFileSync(mapPath, 'utf-8'))
  const gateIds = registryGateIds(readFileSync(registryPath, 'utf-8'))
  const templates = discoverConfigTemplates(root)
  const violations = findViolations(templates, declarations, gateIds)

  if (violations.length > 0) {
    for (const v of violations) process.stdout.write(`  ${v}\n`)
    process.stdout.write(
      `[check-canon15-wired-gate] FAIL: ${violations.length} config template(s) without a wired gate step or a reasoned declaration\n`,
    )
    process.exit(1)
  }
  const gated = declarations.filter((d) => d.gate).length
  process.stdout.write(
    `[check-canon15-wired-gate] OK — ${templates.length} config template(s) (${gated} gated, ${declarations.length - gated} reasoned no-gate)\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
