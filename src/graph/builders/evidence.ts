// SPDX-License-Identifier: Apache-2.0
/**
 * Evidence builder (#259, followup).
 *
 * Reads `.evidence/SUMMARY.json` (or `.arbiter/SUMMARY.json` fallback) and emits:
 *   - one EVIDENCE node
 *   - GATE --produces--> EVIDENCE edge (links to the obs_gate GATE node)
 *
 * The SUMMARY.json schema is defined in src/evidence/summary.ts.
 * Key fields we use: head_sha, obs_gate, timestamp.
 *
 * Degrades gracefully when SUMMARY.json is absent.
 *
 * Existing Code Survey (CANON-16):
 *   - src/evidence/load.ts + summary.ts handle loading/validation — we reuse loadSummaryFile
 *   - no graph builder over SUMMARY.json found
 *   - new file justified: new graph domain (evidence nodes)
 */

import { join } from 'node:path'
import type { GraphNode, GraphEdge } from '../model.js'
import { GraphStore } from '../store.js'
import { loadSummaryFile } from '../../evidence/load.js'

const EVIDENCE_PATHS = [join('.evidence', 'SUMMARY.json'), join('.arbiter', 'SUMMARY.json')]

export interface BuildEvidenceOptions {
  source?: string
  /** Override SUMMARY.json path (for tests). */
  summaryPath?: string
}

const OBS_GATE_ID = 'GATE:obs-gate'

export function buildEvidenceNodes(
  store: GraphStore = new GraphStore(),
  opts: BuildEvidenceOptions = {},
  projectRoot = '.',
): GraphStore {
  const source = opts.source ?? 'evidence-builder'

  // Find the summary file
  let summaryPath: string | undefined
  if (opts.summaryPath !== undefined) {
    summaryPath = opts.summaryPath
  } else {
    for (const candidate of EVIDENCE_PATHS) {
      const full = join(projectRoot, candidate)
      const loaded = loadSummaryFile(full)
      if (loaded.ok) {
        summaryPath = full
        break
      }
    }
  }

  if (summaryPath === undefined) return store

  const loaded = loadSummaryFile(summaryPath)
  if (!loaded.ok) return store

  const summary = loaded.body
  const headSha = typeof summary['head_sha'] === 'string' ? summary['head_sha'] : 'unknown'
  const headShaShort =
    typeof summary['head_sha_short'] === 'string' ? summary['head_sha_short'] : headSha.slice(0, 8)
  const timestamp = typeof summary['timestamp'] === 'string' ? summary['timestamp'] : undefined
  const obsGate = typeof summary['obs_gate'] === 'string' ? summary['obs_gate'] : 'unknown'

  const evidenceId = `EVIDENCE:${headShaShort}`
  const evidenceNode: GraphNode = {
    id: evidenceId,
    kind: 'EVIDENCE',
    attrs: {
      head_sha: headSha,
      head_sha_short: headShaShort,
      obs_gate: obsGate,
      ...(timestamp !== undefined ? { timestamp } : {}),
      path: summaryPath,
      source,
    },
  }
  store.upsertNode(evidenceNode)

  // Ensure the GATE node exists
  store.upsertNode({
    id: OBS_GATE_ID,
    kind: 'GATE',
    attrs: { mechanism: 'obs-gate', title: 'obs-gate', source },
  })

  // GATE --produces--> EVIDENCE
  const edge: GraphEdge = {
    from: OBS_GATE_ID,
    to: evidenceId,
    kind: 'produces',
    attrs: { source },
  }
  store.addEdge(edge)

  return store
}
