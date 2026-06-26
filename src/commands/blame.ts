// SPDX-License-Identifier: Apache-2.0
/**
 * `arbiter blame <node>` — time-travel governance (#263).
 *
 * Reads the persisted graph snapshot, resolves the requested node,
 * harvests its git history, builds a blame timeline and renders it
 * in the requested format.
 *
 * Existing Code Survey (CANON-16):
 *   - grep "export.*runBlame\|export.*Blame" src/ — nothing
 *   - trace.ts: closest analog (same load-snapshot + render pattern)
 *   - Refactor decision: blame needs git log harvesting (trace does not) — different
 *     responsibility. Extracted common snapshot-loading into inline helper consistent
 *     with trace.ts pattern (no shared util yet; premature to extract).
 *   - Decision: new file justified — distinct lifecycle (temporal) vs static trace
 *
 * #263
 */

import { join, resolve } from 'node:path'
import { storeFromSnapshot } from '../graph/store.js'
import { loadGraphSnapshot } from '../graph/load.js'
import { harvestHistoryForNode } from '../graph/history.js'
import {
  buildTimeline,
  formatText,
  formatJson,
  formatMermaid,
  formatMarkdownAudit,
  type ComplianceMapping,
} from '../graph/blame.js'
import { GRAPH_RELATIVE_PATH } from './graph.js'
import { loadComplianceMappings } from '../compliance/loader.js'

export type BlameFormat = 'text' | 'json' | 'mermaid' | 'markdown-audit'

export interface BlameOptions {
  /** Node id to blame (e.g. "INV-05", "FILE:src/auth/service.ts"). */
  from: string
  /** Output format (default: text). */
  format?: BlameFormat
  /** Target directory containing .arbiter/ (default: process.cwd()). */
  dir?: string
  /** Override graph snapshot path (default: <dir>/.arbiter/graph.json). */
  input?: string
  /** Git repository directory for log harvesting (default: dir). */
  gitDir?: string
  /**
   * Skip git log harvesting — returns an empty history.
   * Used in unit tests to avoid git dependency.
   */
  skipGitLog?: boolean
  /** Optional --since filter (e.g. "90d") — informational, used in output. */
  since?: string
}

export interface BlameResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  format: BlameFormat
  output: string
  reason?: string
}

const ALLOWED_FORMATS: readonly BlameFormat[] = ['text', 'json', 'mermaid', 'markdown-audit']

function render(
  fmt: BlameFormat,
  nodeId: string,
  nodeTitle: string,
  events: ReturnType<typeof harvestHistoryForNode>,
  complianceMappings: ComplianceMapping[] | undefined,
): string {
  const timeline = buildTimeline(nodeId, nodeTitle, events, complianceMappings)
  if (fmt === 'json') return formatJson(timeline)
  if (fmt === 'mermaid') return formatMermaid(timeline)
  if (fmt === 'markdown-audit') return formatMarkdownAudit(timeline)
  return formatText(timeline)
}

export function runBlame(opts: BlameOptions): BlameResult {
  const fmt = opts.format ?? 'text'

  if (!ALLOWED_FORMATS.includes(fmt)) {
    return {
      status: 'error',
      exitCode: 2,
      format: 'text',
      output: '',
      reason: `unknown format "${fmt}" — expected one of ${ALLOWED_FORMATS.join(', ')}`,
    }
  }

  const dir = resolve(opts.dir ?? '.')
  const inPath = opts.input !== undefined ? resolve(opts.input) : join(dir, GRAPH_RELATIVE_PATH)

  const loaded = loadGraphSnapshot(inPath)
  if (!loaded.ok) {
    return { status: 'error', exitCode: 2, format: fmt, output: '', reason: loaded.reason }
  }

  const store = storeFromSnapshot(loaded.snapshot)
  if (!store.hasNode(opts.from)) {
    return {
      status: 'error',
      exitCode: 2,
      format: fmt,
      output: '',
      reason: `unknown node id "${opts.from}" in graph snapshot at ${inPath}`,
    }
  }

  const node = store.getNode(opts.from)
  const nodeTitle = typeof node?.attrs['title'] === 'string' ? node.attrs['title'] : opts.from

  // Harvest git history unless test mode skips it
  const gitDir = resolve(opts.gitDir ?? opts.dir ?? '.')
  const events =
    opts.skipGitLog === true ? [] : harvestHistoryForNode({ nodeId: opts.from, gitDir })

  // Load optional compliance mappings
  const complianceMappings = loadComplianceMappings(dir, opts.from)

  const output = render(fmt, opts.from, nodeTitle, events, complianceMappings)
  return { status: 'ok', exitCode: 0, format: fmt, output }
}
