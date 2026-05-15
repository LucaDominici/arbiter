// SPDX-License-Identifier: Apache-2.0
import { resolve, join, dirname } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { buildIntermediate, type AgentRulesIntermediate } from '../agent-rules/intermediate.js'
import {
  ALL_TARGETS,
  TARGET_SPECS,
  isAgentRulesTarget,
  type AgentRulesTarget,
} from '../agent-rules/targets.js'

/**
 * `arbiter agent-rules export` and `arbiter agent-rules verify` (#265).
 *
 * Export derives agent rules from the provenance graph (or INV catalog
 * fallback) and renders them to the requested target format.
 *
 * Verify diffs the current file on disk against a fresh export and exits
 * non-zero if they differ (drift detection).
 */

// ─── Export ───────────────────────────────────────────────────────────────────

export interface AgentRulesExportOptions {
  dir?: string
  target?: string
  /** Emit all targets to their standard paths. */
  all?: boolean
  json?: boolean
}

export interface AgentRulesExportResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  /** The rendered content (only for single-target exports). */
  content: string
  intermediate?: AgentRulesIntermediate
  /** True if the INV catalog fallback was used (no graph.json). */
  fallbackUsed?: boolean
  /** Written file paths (for --all). */
  filesWritten?: string[]
  reason?: string
}

export function runAgentRulesExport(opts: AgentRulesExportOptions): AgentRulesExportResult {
  const dir = resolve(opts.dir ?? '.')

  // Validate target
  if (!opts.all && opts.target !== undefined && !isAgentRulesTarget(opts.target)) {
    return {
      status: 'error',
      exitCode: 2,
      content: '',
      reason: `unknown target "${opts.target}" — valid targets: ${ALL_TARGETS.join(', ')}`,
    }
  }

  const { intermediate, fallbackUsed } = buildIntermediate({ dir })

  if (opts.all) {
    return exportAll(dir, intermediate, fallbackUsed)
  }

  const targetName = opts.target ?? 'claude'
  const target: AgentRulesTarget = isAgentRulesTarget(targetName) ? targetName : 'claude'
  const spec = TARGET_SPECS[target]
  const content = spec.emit(intermediate)

  return {
    status: 'ok',
    exitCode: 0,
    content,
    intermediate,
    fallbackUsed,
  }
}

function exportAll(
  dir: string,
  intermediate: AgentRulesIntermediate,
  fallbackUsed: boolean,
): AgentRulesExportResult {
  const filesWritten: string[] = []

  for (const target of ALL_TARGETS) {
    const spec = TARGET_SPECS[target]
    const content = spec.emit(intermediate)
    const outPath = join(dir, spec.outputPath)
    try {
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, content, 'utf-8')
      filesWritten.push(outPath)
    } catch (err) {
      return {
        status: 'error',
        exitCode: 2,
        content: '',
        reason: `Failed to write ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  return {
    status: 'ok',
    exitCode: 0,
    content: '',
    intermediate,
    fallbackUsed,
    filesWritten,
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────────

export interface AgentRulesVerifyOptions {
  dir?: string
  target?: string
  json?: boolean
}

export interface AgentRulesVerifyResult {
  status: 'ok' | 'error'
  exitCode: 0 | 1 | 2
  target: AgentRulesTarget
  /** True if the file is missing (not yet exported). */
  missing?: boolean
  /** True if the file content differs from a fresh export. */
  drift?: boolean
  reason?: string
}

export function runAgentRulesVerify(opts: AgentRulesVerifyOptions): AgentRulesVerifyResult {
  const dir = resolve(opts.dir ?? '.')
  const targetStr = opts.target ?? 'claude'

  if (!isAgentRulesTarget(targetStr)) {
    return {
      status: 'error',
      exitCode: 2,
      target: 'claude',
      reason: `unknown target "${targetStr}" — valid targets: ${ALL_TARGETS.join(', ')}`,
    }
  }

  const spec = TARGET_SPECS[targetStr]
  const outPath = join(dir, spec.outputPath)

  if (!existsSync(outPath)) {
    // Missing = not yet exported; not a failure
    return {
      status: 'ok',
      exitCode: 0,
      target: targetStr,
      missing: true,
      drift: false,
    }
  }

  const current = readFileSync(outPath, 'utf-8')
  const { intermediate } = buildIntermediate({ dir })
  const fresh = spec.emit(intermediate)

  if (current !== fresh) {
    return {
      status: 'error',
      exitCode: 1,
      target: targetStr,
      missing: false,
      drift: true,
      reason: `${spec.outputPath} is stale — re-run \`arbiter agent-rules export --target ${targetStr}\` to refresh`,
    }
  }

  return {
    status: 'ok',
    exitCode: 0,
    target: targetStr,
    missing: false,
    drift: false,
  }
}
