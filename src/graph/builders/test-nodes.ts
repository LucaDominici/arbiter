/**
 * Test-file builder (#259, followup).
 *
 * Scans test files for `[INV-NN]` or `[REQ-NN]` tags in test titles and emits:
 *   - TEST nodes (one per file, not per test case)
 *   - TEST --proves--> INV/REQ edges for each tag found
 *
 * Test title patterns recognised:
 *   vitest/jest: it / test / describe calls whose title starts with [INV-NN] or [REQ-NN]
 *   e.g. title '[INV-04] no any types' or '[REQ-001] …'
 *
 * TEST node id: "TEST:<relativePath>"
 * TEST node attrs: { path, invRefs[], reqRefs[], source }
 *
 * Existing Code Survey (CANON-16):
 *   - no existing test file scanner found in src/
 *   - new file justified: new domain (test node harvesting with tag extraction)
 */

import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { GraphNode, GraphEdge } from '../model.js'
import { GraphStore } from '../store.js'
import { walkFiles, unique } from './utils.js'

const TEST_EXT_RE = /\.(test|spec)\.(ts|tsx|js|mts)$/
const TEST_TITLE_RE = /(?:it|test|describe)\s*\(\s*[`'"]/

export interface BuildTestOptions {
  source?: string
  /** Directories to skip. Defaults to node_modules, dist, .git. */
  skipDirs?: string[]
  /** Custom test file pattern (for tests). */
  pattern?: RegExp
}

const DEFAULT_SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage'])

export interface TestFileEntry {
  id: string
  path: string
  invRefs: string[]
  reqRefs: string[]
}

/** Extract INV and REQ ids from tags like [INV-04] or [REQ-001] in a line. */
function extractTagsFromLine(line: string): { invRefs: string[]; reqRefs: string[] } {
  const invRefs: string[] = []
  const reqRefs: string[] = []
  // Use matchAll for safe iteration without exec
  const matches = Array.from(line.matchAll(/\[(INV-\d+|REQ-\d+)\]/g), (m) => m[1])
  for (const tag of matches) {
    if (tag === undefined) continue
    if (tag.startsWith('INV-')) invRefs.push(tag)
    else if (tag.startsWith('REQ-')) reqRefs.push(tag)
  }
  return { invRefs, reqRefs }
}

export function parseTestFile(text: string, relPath: string): TestFileEntry {
  const invRefs: string[] = []
  const reqRefs: string[] = []

  for (const line of text.split('\n')) {
    if (!TEST_TITLE_RE.test(line)) continue
    const tags = extractTagsFromLine(line)
    invRefs.push(...tags.invRefs)
    reqRefs.push(...tags.reqRefs)
  }

  return {
    id: `TEST:${relPath}`,
    path: relPath,
    invRefs: unique(invRefs),
    reqRefs: unique(reqRefs),
  }
}

export function buildTestNodes(
  store: GraphStore = new GraphStore(),
  opts: BuildTestOptions = {},
  projectRoot = '.',
): GraphStore {
  const source = opts.source ?? 'test-builder'
  const skipDirs = opts.skipDirs !== undefined ? new Set(opts.skipDirs) : DEFAULT_SKIP_DIRS
  const pattern = opts.pattern ?? TEST_EXT_RE

  if (!existsSync(projectRoot)) return store

  const files = walkFiles(projectRoot, (f) => {
    const segments = f.replace(/\\/g, '/').split('/')
    for (const seg of segments) {
      if (skipDirs.has(seg)) return false
    }
    return pattern.test(f)
  })

  for (const filePath of files) {
    let text: string
    try {
      text = readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }
    const relPath = relative(projectRoot, filePath)
    emitTestFileNodes(store, parseTestFile(text, relPath), source)
  }

  return store
}

function emitTestFileNodes(store: GraphStore, entry: TestFileEntry, source: string): void {
  if (entry.invRefs.length === 0 && entry.reqRefs.length === 0) return

  const node: GraphNode = {
    id: entry.id,
    kind: 'TEST',
    attrs: { path: entry.path, invRefs: entry.invRefs, reqRefs: entry.reqRefs, source },
  }
  store.upsertNode(node)

  for (const invId of entry.invRefs) {
    if (!store.hasNode(invId))
      store.upsertNode({ id: invId, kind: 'INV', attrs: { source: 'test-stub' } })
    const edge: GraphEdge = { from: entry.id, to: invId, kind: 'proves', attrs: { source } }
    store.addEdge(edge)
  }

  for (const reqId of entry.reqRefs) {
    if (!store.hasNode(reqId))
      store.upsertNode({ id: reqId, kind: 'REQ', attrs: { source: 'test-stub' } })
    const edge: GraphEdge = { from: entry.id, to: reqId, kind: 'proves', attrs: { source } }
    store.addEdge(edge)
  }
}
