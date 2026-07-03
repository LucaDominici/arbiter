// SPDX-License-Identifier: Apache-2.0
import { SKILL_NAMES } from '../generators/skills.js'

type InstallSource = 'builtin' | 'plugin' | 'npm'

/**
 * #1730 — companion activation policy. Present on a `SkillEntry` when that installed
 * skill is a `/ship` companion (a drafting-time persona arbiter composes with, never
 * vendors). Absent ⇒ the entry is a normal detect-and-recommend integration, not a ship
 * companion. `greenInstruction` is appended to the `green` phase action (omit for
 * announce-only companions); `{mode}` is substituted with the resolved lite|full mode.
 */
export interface CompanionPolicy {
  /** Human label shown in the `Companion:` announcement (e.g. "ponytail"). */
  label: string
  /** Mode used when the user has no per-companion override. Never `ultra` (ultra skips tests). */
  defaultMode: 'lite' | 'full'
  /** Instruction appended to the green-phase action. Omit for announce-only companions. */
  greenInstruction?: string
}

export interface SkillEntry {
  id: string
  owner: string
  role: string
  installCmd: string
  installSource: InstallSource
  /** #1730 — set only for `/ship` companion plugins (ponytail). Absent = plain integration. */
  companion?: CompanionPolicy
}

/** The bare skill name of a (possibly namespaced) id — `superpowers:tdd` → `tdd`. */
export function bareName(id: string): string {
  return id.includes(':') ? (id.split(':')[1] ?? id) : id
}

const ARBITER_SKILLS: SkillEntry[] = SKILL_NAMES.map((id) => ({
  id,
  owner: 'arbiter',
  role: 'governance',
  installCmd: 'arbiter init  # generates automatically',
  installSource: 'builtin',
}))

// Known third-party skills referenced by detect-and-reference posture (docs/INTEGRATIONS.md)
const UPSTREAM_SKILLS: SkillEntry[] = [
  {
    id: 'superpowers:using-superpowers',
    owner: 'claude-plugins-official',
    role: 'session-bootstrap',
    installCmd: '/plugin add claude-plugins-official/superpowers',
    installSource: 'plugin',
  },
  {
    id: 'pr-review-toolkit:review-pr',
    owner: 'claude-plugins-official',
    role: 'pr-review',
    installCmd: '/plugin add claude-plugins-official/pr-review-toolkit',
    installSource: 'plugin',
  },
  {
    id: 'frontend-design:frontend-design',
    owner: 'claude-plugins-official',
    role: 'ui-design',
    installCmd: '/plugin add claude-plugins-official/frontend-design',
    installSource: 'plugin',
  },
  // #1730 — ponytail: a YAGNI/minimalist drafting persona. arbiter DETECTS and composes
  // with it in /ship's green phase (product repos only, never arbiter-self); it is never
  // vendored. Detected by the bare skill name `ponytail`, so the derived plugin owner is
  // irrelevant. arbiter's gates remain the safety net if the persona cuts too much.
  {
    id: 'ponytail:ponytail',
    owner: 'DietrichGebert',
    role: 'drafting-persona',
    installCmd:
      '/plugin marketplace add DietrichGebert/ponytail && /plugin install ponytail@ponytail',
    installSource: 'plugin',
    companion: {
      label: 'ponytail',
      defaultMode: 'full',
      greenInstruction:
        'Companion ponytail is active in {mode} mode: while implementing, climb ponytail’s ' +
        'YAGNI ladder — reuse existing code, prefer stdlib/native features, resist new ' +
        'dependencies and speculative abstractions, and ship the shortest working diff. Never skip ' +
        'tests, input validation, security, or error handling, and never use ultra mode — ' +
        'arbiter’s gates remain the safety net.',
    },
  },
]

export const SKILLS_MATRIX: SkillEntry[] = [...ARBITER_SKILLS, ...UPSTREAM_SKILLS]
