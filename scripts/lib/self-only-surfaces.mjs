// SPDX-License-Identifier: Apache-2.0
// scripts/lib/self-only-surfaces.mjs — #2417 AC-1: derive arbiter's self-only
// surfaces (commands, skills, agents, hooks that live under this repo's own
// .claude/ but are never emitted to a target project) from the existing SSOTs,
// rather than hand-listing them:
//   - commands: .claude/commands/*.md minus src/templates/claude/commands/*.md.ejs
//   - skills:   .claude/skills/*/     minus src/generators/skill-names.json
//   - agents:   .claude/agents/*.md   minus src/templates/claude/agents/*.md.ejs
//   - hooks:    the `.claude/hooks/*` entries already reasoned about in
//               scripts/canon01-self-only.json (CANON-01's own self-only ledger)
//
// Consumed by scripts/gen-llms-txt.mjs (marks self-only commands in the
// runbook list) and by __tests__/scripts/self-only-surfaces.test.ts, which
// asserts scripts/data/self-only-surfaces.json equals this derivation.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function baseNames(dir, suffix) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length))
}

function selfOnlyOf(local, emitted) {
  const emittedSet = new Set(emitted)
  return local.filter((name) => !emittedSet.has(name)).sort()
}

/** @param {string} root repo root */
export function deriveSelfOnlySurfaces(root) {
  const commands = selfOnlyOf(
    baseNames(join(root, '.claude/commands'), '.md'),
    baseNames(join(root, 'src/templates/claude/commands'), '.md.ejs'),
  )

  const skills = selfOnlyOf(
    readdirSync(join(root, '.claude/skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name),
    JSON.parse(readFileSync(join(root, 'src/generators/skill-names.json'), 'utf-8')),
  )

  const agents = selfOnlyOf(
    baseNames(join(root, '.claude/agents'), '.md'),
    baseNames(join(root, 'src/templates/claude/agents'), '.md.ejs'),
  )

  const canon01 = JSON.parse(readFileSync(join(root, 'scripts/canon01-self-only.json'), 'utf-8'))
  const hooks = canon01.selfOnly
    .map((e) => e.path)
    .filter((p) => p.startsWith('.claude/hooks/'))
    .sort()

  return { commands, skills, agents, hooks }
}
