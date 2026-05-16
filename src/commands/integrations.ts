// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { jsonOutput } from '../utils/json-output.js'
import { SKILLS_MATRIX } from '../integrations/skills-matrix.js'
import type { SkillEntry } from '../integrations/skills-matrix.js'

export interface IntegrationsListOptions {
  dir?: string
  json?: boolean
}

export interface IntegrationStatus extends SkillEntry {
  detected: boolean
}

export interface IntegrationsListResult {
  detected: IntegrationStatus[]
  recommended: IntegrationStatus[]
}

function skillSearchPaths(dir: string): string[] {
  return [
    join(homedir(), '.claude', 'skills'),
    join(homedir(), '.claude', 'plugins'),
    join(dir, '.claude', 'skills'),
  ]
}

function isDetected(id: string, searchPaths: string[]): boolean {
  // skill id may be namespaced (e.g. "superpowers:using-superpowers")
  const base = id.includes(':') ? (id.split(':')[1] ?? id) : id
  return searchPaths.some((p) => existsSync(join(p, base)) || existsSync(join(p, id)))
}

export function runIntegrationsList(opts: IntegrationsListOptions = {}): IntegrationsListResult {
  const dir = resolve(opts.dir ?? '.')
  const paths = skillSearchPaths(dir)

  const statuses: IntegrationStatus[] = SKILLS_MATRIX.map((entry) => ({
    ...entry,
    detected: isDetected(entry.id, paths),
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
