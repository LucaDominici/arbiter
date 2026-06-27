// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { jsonOutput } from '../utils/json-output.js'
import { SKILLS_MATRIX } from '../integrations/skills-matrix.js'
import type { SkillEntry } from '../integrations/skills-matrix.js'
import { detectInstalledSkills } from '../integrations/skill-detector.js'

export interface IntegrationsListOptions {
  dir?: string
  json?: boolean
  /**
   * Override the Claude home (`~/.claude`) whose `plugins/cache` and `skills`
   * trees are scanned for installed skills. Defaults to the real user home;
   * tests inject an isolated dir for determinism.
   */
  claudeHome?: string
}

interface IntegrationStatus extends SkillEntry {
  detected: boolean
}

export interface IntegrationsListResult {
  detected: IntegrationStatus[]
  recommended: IntegrationStatus[]
}

/** The bare skill name of a (possibly namespaced) id — `superpowers:tdd` → `tdd`. */
function bareName(id: string): string {
  return id.includes(':') ? (id.split(':')[1] ?? id) : id
}

export function runIntegrationsList(opts: IntegrationsListOptions = {}): IntegrationsListResult {
  const dir = resolve(opts.dir ?? '.')
  const claudeHome = opts.claudeHome ?? join(homedir(), '.claude')

  // Reuse the single #1566/#1634-hardened detector instead of reimplementing
  // detection with flat existsSync probes that never matched a real nested
  // plugin-cache path (#1613 Problem 1). A matrix entry is detected when its id
  // equals an installed skillId, or its bare name equals an installed bare name.
  const installed = detectInstalledSkills({ targetDir: dir, claudeHome })
  const installedIds = new Set(installed.map((s) => s.skillId))
  const installedBareNames = new Set(installed.map((s) => bareName(s.skillId)))

  const statuses: IntegrationStatus[] = SKILLS_MATRIX.map((entry) => ({
    ...entry,
    detected: installedIds.has(entry.id) || installedBareNames.has(bareName(entry.id)),
  }))

  const detected = statuses.filter((s) => s.detected)
  const recommended = statuses.filter((s) => !s.detected)
  const result: IntegrationsListResult = { detected, recommended }

  if (opts.json) {
    jsonOutput('integrations-list', 'ok', result as unknown as Record<string, unknown>)
    return result
  }

  process.stdout.write('\nDetected integrations:\n')
  if (detected.length === 0) {
    process.stdout.write('  (none)\n')
  } else {
    for (const s of detected) {
      process.stdout.write(`  [detected]  ${s.id}  [${s.owner}]  — ${s.role}\n`)
    }
  }

  process.stdout.write('\nRecommended integrations:\n')
  if (recommended.length === 0) {
    process.stdout.write('  (all installed)\n')
  } else {
    for (const r of recommended) {
      process.stdout.write(`  [missing]   ${r.id}  [${r.owner}]  — install: ${r.installCmd}\n`)
    }
  }
  process.stdout.write('\n')

  return result
}
