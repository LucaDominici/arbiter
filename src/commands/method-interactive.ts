// SPDX-License-Identifier: Apache-2.0
// #2039: the interactive half of `arbiter method` — a cluster lens over the SAME fields
// `configure` already edits, re-grouped by feature instead of by dotted path.
//
// Two contracts this file exists to keep literal:
//
//  1. NO PARALLEL CONFIG ENGINE. Every prompt produces a `path=value` string and nothing
//     else. The only write is one `runConfigure({ dir, sets })` call at the very bottom,
//     which is what performs validation, validateConfig, the `.arbiter/.lock` acquisition
//     and the atomic save. `saveConfig` is not imported here and must never be.
//
//  2. NO HIDDEN STATE. Staging lives in a local array in the running process. There is no
//     `.arbiter/method-pending.json` and no other on-disk queue, so "cancel writes nothing"
//     is true by construction rather than by cleanup. `isCancel` at any prompt returns
//     immediately with zero writes.
//
// Value validation is NOT duplicated: non-boolean prompts hand the raw string straight to
// `configure`'s own `parseValue`, so the lens can never accept a value `configure --set`
// would reject, and adding a new enum to configure.ts needs no edit here.

import { resolve } from 'node:path'
import { loadConfig } from '../utils/config.js'
import { runConfigure, parseValue } from './configure.js'
import {
  CLUSTERS,
  METHODOLOGY_CATALOG,
  probeAll,
  type Cluster,
  type FeatureStatus,
  type MethodologyFeature,
} from './method.js'

/** Booleans get a yes/no prompt; everything else gets text validated by parseValue. */
function isBooleanPath(path: string): boolean {
  return path.startsWith('features.')
}

function currentString(values: Record<string, unknown>, path: string): string {
  const v = values[path]
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.join(',')
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  // A non-scalar here would stringify to '[object Object]' and be offered as an editable
  // value; no ALLOWED_PATH holds one today, so treat it as "no current value" rather than
  // prefilling the prompt with something the user cannot possibly retype.
  return ''
}

const VERDICT_HINT: Record<FeatureStatus['verdict'], string> = {
  wired: 'on, files emitted',
  partial: 'on, files NOT emitted',
  unverified: 'on, emission uncheckable (no manifest)',
  off: 'off',
}

/**
 * Prompt for one feature's paths. Returns the staged `path=value` assignments, or `null`
 * when the user cancelled — which aborts the whole session rather than half-applying.
 */
async function promptFeature(
  clack: typeof import('@clack/prompts'),
  feature: MethodologyFeature,
  status: FeatureStatus,
): Promise<string[] | null> {
  const staged: string[] = []
  for (const path of feature.configPaths) {
    const before = currentString(status.values, path)

    if (isBooleanPath(path)) {
      const next = await clack.confirm({
        message: path,
        initialValue: status.values[path] === true,
      })
      if (clack.isCancel(next)) return null
      if (String(next) !== before) staged.push(`${path}=${String(next)}`)
      continue
    }

    const next = await clack.text({
      message: path,
      initialValue: before,
      validate: (raw) => {
        const value = raw ?? ''
        if (value.trim() === '') return 'Provide a value, or press Ctrl-C to cancel.'
        try {
          parseValue(path, value)
          return undefined
          // FAIL-OPEN-INTENT: not swallowed — the message IS the surface. A clack `validate` returns a string to REJECT the input and re-prompt, so returning the error text is how the failure reaches the user; throwing here would kill the session instead of correcting the value.
        } catch (err) {
          return err instanceof Error ? err.message : String(err)
        }
      },
    })
    if (clack.isCancel(next)) return null
    if (next !== before) staged.push(`${path}=${next}`)
  }
  return staged
}

/** One pass through a cluster: pick features, prompt each. `null` = cancelled. */
async function promptCluster(
  clack: typeof import('@clack/prompts'),
  cluster: Cluster,
  statuses: FeatureStatus[],
): Promise<string[] | null> {
  const rows = METHODOLOGY_CATALOG.filter((f) => f.cluster === cluster)
  const byId = new Map(statuses.map((s) => [s.id, s]))

  const picked = await clack.multiselect({
    message: `${cluster} — which features do you want to change?`,
    options: rows.map((f) => ({
      value: f.id,
      label: f.name,
      hint: VERDICT_HINT[byId.get(f.id)?.verdict ?? 'off'],
    })),
    required: false,
  })
  if (clack.isCancel(picked)) return null

  const staged: string[] = []
  for (const id of picked) {
    const feature = rows.find((f) => f.id === id)
    const status = byId.get(id)
    if (!feature || !status) continue
    const result = await promptFeature(clack, feature, status)
    if (result === null) return null
    staged.push(...result)
  }
  return staged
}

/**
 * `arbiter method` with no subcommand on a TTY. The caller (cli.ts) owns the TTY check,
 * matching `configure`'s split.
 */
export async function runInteractiveMethod(dir?: string): Promise<void> {
  const clack = await import('@clack/prompts')
  const targetDir = resolve(dir ?? process.cwd())
  const config = loadConfig(targetDir)
  if (!config) {
    process.stderr.write('arbiter: no arbiter.json found. Run `arbiter init` first.\n')
    process.exit(1)
    // Not dead code, despite the unreachable-code hint: process.exit is `never` only in
    // production. Tests mock it, and a mock that records and RETURNS would otherwise fall
    // through to the probe below with a null config. Same guard as configure-interactive.ts.
    return
  }

  const statuses = probeAll(targetDir, config)
  const wired = statuses.filter((s) => s.verdict === 'wired').length
  const partial = statuses.filter((s) => s.verdict === 'partial').length
  const off = statuses.filter((s) => s.verdict === 'off').length

  clack.intro('arbiter method')
  clack.note(
    `wired ${wired}   partial ${partial}   off ${off}\n` +
      `Full report: arbiter method status (or --json)`,
    'methodology',
  )

  const cluster = await clack.select({
    message: 'Which cluster do you want to tune?',
    options: CLUSTERS.map((c) => ({
      value: c,
      label: c,
      hint: `${statuses.filter((s) => s.cluster === c && s.verdict === 'wired').length}/${
        statuses.filter((s) => s.cluster === c).length
      } wired`,
    })),
  })
  if (clack.isCancel(cluster)) {
    clack.cancel('Cancelled — nothing written.')
    return
  }

  const staged = await promptCluster(clack, cluster, statuses)
  if (staged === null) {
    clack.cancel('Cancelled — nothing written.')
    return
  }
  if (staged.length === 0) {
    clack.outro('No changes.')
    return
  }

  clack.note(staged.join('\n'), 'staged changes')
  const apply = await clack.confirm({ message: 'Apply these changes?', initialValue: true })
  if (clack.isCancel(apply) || !apply) {
    clack.cancel('Cancelled — nothing written.')
    return
  }

  // The one and only write, and it is `configure`'s.
  await runConfigure({ dir: targetDir, sets: staged })
  clack.outro('Applied via arbiter configure.')
}
