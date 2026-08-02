// SPDX-License-Identifier: Apache-2.0
//
// Deterministic /ship tier widening (#2180): optional metadata may widen, never narrow.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readUnifiedState } from './task-state.js'
import { runCliJson } from '../utils/run-cli.js'

export type ShipTier = 'XS' | 'S' | 'Standard'

export interface TierSignals {
  /** Distinct dependent files; null when the optional graph signal is unavailable. */
  blastRadius: number | null
  /** Lowercased issue labels; empty when the optional issue-metadata signal is unavailable. */
  labels: readonly string[]
  /** Whether the issue belongs to a GitHub milestone bundle. */
  milestoneBundled: boolean
}

const TIER_RANK: Record<ShipTier, number> = { XS: 0, S: 1, Standard: 2 }
const WAVE_OR_EPIC = /^(?:wave|epic)(?:\/.*)?$/i
const GRAPH_MAX_BYTES = 256 * 1024 * 1024
const ALLOWED_RELATIONS = new Set([
  'imports',
  'imports_from',
  'calls',
  'references',
  're_exports',
  'implements',
  'inherits',
  'extends',
  'uses',
  'depends_on',
])

// #2180 calibration on this repo: leaf test=4, small generator=20, task-ship.ts=30,
// cli.ts=78, catalog.ts=116, registry.ts=236, and #1730's M-sized plan manifest=679.
const BLAST_RADIUS_S = 25
const BLAST_RADIUS_STANDARD = 75

export function normTier(tier: string | undefined): ShipTier {
  if (tier === 'XS' || tier === 'S') return tier
  return 'Standard'
}

/** Return the highest deterministic floor; signals are intentionally unable to narrow a tier. */
export function widenTier(base: ShipTier, signals: TierSignals): ShipTier {
  let result = base
  const widenTo = (floor: ShipTier): void => {
    if (TIER_RANK[floor] > TIER_RANK[result]) result = floor
  }

  if (signals.milestoneBundled || signals.labels.some((label) => WAVE_OR_EPIC.test(label))) {
    widenTo('Standard')
  }

  const blastRadius = signals.blastRadius
  if (typeof blastRadius === 'number' && Number.isFinite(blastRadius) && blastRadius >= 0) {
    if (blastRadius >= BLAST_RADIUS_STANDARD) widenTo('Standard')
    else if (blastRadius >= BLAST_RADIUS_S) widenTo('S')
  }
  return result
}

/**
 * Collect optional, deterministic routing signals. Every unavailable or malformed source becomes
 * its neutral value so /ship retains its existing fail-safe tier behaviour.
 */
export function gatherTierSignals(root: string, taskId: string | undefined): TierSignals {
  try {
    const issue = gatherIssueSignals(root, taskId)
    return { ...issue, blastRadius: gatherBlastRadius(root) }
  } catch {
    return { blastRadius: null, labels: [], milestoneBundled: false }
  }
}

function gatherIssueSignals(
  root: string,
  taskId: string | undefined,
): Pick<TierSignals, 'labels' | 'milestoneBundled'> {
  const issueNumber = taskId?.replace(/^#/, '')
  if (issueNumber === undefined || !/^\d+$/.test(issueNumber)) {
    return { labels: [], milestoneBundled: false }
  }
  try {
    const response = runCliJson(
      'gh',
      ['issue', 'view', issueNumber, '--json', 'labels,milestone'],
      { cwd: root, timeoutMs: 10_000 },
    )
    if (!isIssueResponse(response)) return { labels: [], milestoneBundled: false }
    return {
      labels: response.labels.map((label) => label.name.toLowerCase()),
      milestoneBundled: response.milestone !== null,
    }
  } catch {
    return { labels: [], milestoneBundled: false }
  }
}

function gatherBlastRadius(root: string): number | null {
  try {
    const manifest = readPlanManifest(root)
    if (manifest === null || manifest.size === 0) return null

    const graphPath = join(root, 'graphify-out', 'graph.json')
    if (!existsSync(graphPath)) return null
    const graphStat = statSync(graphPath)
    if (graphStat.size > GRAPH_MAX_BYTES) return null
    for (const file of manifest) {
      const path = join(root, file)
      if (existsSync(path) && graphStat.mtimeMs < statSync(path).mtimeMs) return null
    }

    return countBlastRadius(JSON.parse(readFileSync(graphPath, 'utf-8')) as unknown, manifest)
  } catch {
    return null
  }
}

function readPlanManifest(root: string): Set<string> | null {
  const plan = readUnifiedState(root)?.plan
  if (typeof plan !== 'string' || !isRepoRelativePosixPath(plan)) return null
  const files = parsePlanFilesManifest(readFileSync(join(root, plan), 'utf-8'))
  return files === null || files.length === 0 ? null : new Set(files)
}

function parsePlanFilesManifest(plan: string): string[] | null {
  const frontMatter = plan.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  if (frontMatter === undefined) return null
  const lines = frontMatter.split(/\r?\n/)
  const filesIndex = lines.findIndex((line) => /^files:\s*$/.test(line))
  if (filesIndex === -1) return null
  const files: string[] = []
  for (const line of lines.slice(filesIndex + 1)) {
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s*/.test(line)) break
    if (line.trim() === '') continue
    const match = line.match(/^\s+-\s+(.+?)\s*$/)
    const file = match?.[1]
    if (file === undefined || !isRepoRelativePosixPath(file)) return null
    files.push(file)
  }
  return files
}

function countBlastRadius(graph: unknown, manifest: ReadonlySet<string>): number | null {
  if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) return null
  const sourceFiles = graphNodeSourceFiles(graph.nodes)

  const dependents = new Set<string>()
  for (const link of graph.links) {
    const files = allowlistedEdgeFiles(link, sourceFiles)
    if (files !== null) addDependentFiles(manifest, dependents, files)
  }
  return dependents.size
}

function graphNodeSourceFiles(nodes: unknown[]): Map<string, string> {
  const sourceFiles = new Map<string, string>()
  for (const node of nodes) {
    if (isGraphNode(node)) sourceFiles.set(node.id, node.source_file)
  }
  return sourceFiles
}

function isGraphNode(value: unknown): value is { id: string; source_file: string } {
  return isRecord(value) && typeof value.id === 'string' && typeof value.source_file === 'string'
}

function allowlistedEdgeFiles(
  link: unknown,
  sourceFiles: ReadonlyMap<string, string>,
): readonly [string, string] | null {
  if (!isRecord(link)) return null
  const { source, target, relation } = link
  if (
    typeof source !== 'string' ||
    typeof target !== 'string' ||
    typeof relation !== 'string' ||
    !ALLOWED_RELATIONS.has(relation)
  ) {
    return null
  }
  const sourceFile = sourceFiles.get(source)
  const targetFile = sourceFiles.get(target)
  return sourceFile === undefined || targetFile === undefined ? null : [sourceFile, targetFile]
}

function addDependentFiles(
  manifest: ReadonlySet<string>,
  dependents: Set<string>,
  [source, target]: readonly [string, string],
): void {
  if (manifest.has(source) && !manifest.has(target)) dependents.add(target)
  if (manifest.has(target) && !manifest.has(source)) dependents.add(source)
}

function isIssueResponse(value: unknown): value is {
  labels: { name: string }[]
  milestone: unknown
} {
  return (
    isRecord(value) &&
    Array.isArray(value.labels) &&
    value.labels.every((label) => isRecord(label) && typeof label.name === 'string') &&
    Object.hasOwn(value, 'milestone')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRepoRelativePosixPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
}
