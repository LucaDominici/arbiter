// SPDX-License-Identifier: Apache-2.0
/**
 * AST/symbol builder (#259, followup).
 *
 * Scans TypeScript source files for JSDoc annotations:
 *   - `@enforces INV-NN` -> SYMBOL --implements--> INV
 *   - `@invariant INV-NN` -> same edge
 *
 * Implementation choice: regex over .ts file content, not the TS compiler API.
 * Rationale: the TS compiler API would require `typescript` as a runtime dep
 * and is significantly heavier. Regex is sufficient for well-formed JSDoc in v1.
 * Limitation documented: multi-line JSDoc annotations where the tag is on a
 * different line than the INV id may be missed.
 *
 * For Java/Rust: regex-only stubs (advisory, not gate-wired per issue spec).
 *
 * SYMBOL node id: "SYMBOL:<relativePath>:<symbolName>"
 *
 * Existing Code Survey (CANON-16):
 *   - grepped for @enforces, @invariant in src/ — no matches (new pattern)
 *   - no AST scanner found
 *   - new file justified: new domain (code annotation harvesting)
 */

import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { GraphNode, GraphEdge } from '../model.js'
import { GraphStore } from '../store.js'
import { walkFiles, extractInvRefs } from './utils.js'

const TS_EXT_RE = /\.(ts|tsx)$/
const JAVA_EXT_RE = /\.java$/
const RUST_EXT_RE = /\.rs$/
const ANNOTATION_RE = /@enforces\b|@invariant\b/
const JSDOC_OPEN_RE = /\/\*\*/
const JSDOC_CLOSE_RE = /\*\//
const SYMBOL_DECL_RE =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|abstract\s+class)\s+(\w+)/
const BARE_DECL_RE = /^(?:async\s+)?(?:function|class)\s+(\w+)/

export interface BuildAstOptions {
  source?: string
  /** Restrict scan to these extensions (default: ts + tsx). */
  extensions?: ('ts' | 'java' | 'rust')[]
  /** Directories to skip (relative to projectRoot). Defaults to common skip list. */
  skipDirs?: string[]
}

const DEFAULT_SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '__tests__'])

export interface AstAnnotation {
  symbolName: string
  invIds: string[]
}

/**
 * Extract (symbolName, invIds[]) pairs from a file text.
 *
 * Heuristic:
 *  1. Find JSDoc blocks containing @enforces or @invariant.
 *  2. Collect INV-NN ids from those lines.
 *  3. Look at the next non-blank line — it should declare a symbol.
 */
export function extractAnnotations(text: string): AstAnnotation[] {
  const lines = text.split('\n')
  const annotations: AstAnnotation[] = []

  let inJsDoc = false
  let pendingInvIds: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue

    if (!inJsDoc) {
      if (JSDOC_OPEN_RE.test(line)) {
        inJsDoc = true
        pendingInvIds = []
        if (ANNOTATION_RE.test(line)) {
          pendingInvIds.push(...extractInvRefs(line))
        }
      }
      continue
    }

    // Inside JSDoc block
    if (JSDOC_CLOSE_RE.test(line)) {
      inJsDoc = false
      if (pendingInvIds.length > 0) {
        const symbolName = findNextSymbolName(lines, i + 1)
        if (symbolName !== null) {
          annotations.push({ symbolName, invIds: [...pendingInvIds] })
        }
        pendingInvIds = []
      }
      continue
    }

    if (ANNOTATION_RE.test(line)) {
      pendingInvIds.push(...extractInvRefs(line))
    }
  }

  return annotations
}

function findNextSymbolName(lines: string[], startIdx: number): string | null {
  for (let j = startIdx; j < Math.min(startIdx + 5, lines.length); j++) {
    const rawLine = lines[j]
    if (rawLine === undefined) continue
    const line = rawLine.trim()
    if (line === '') continue
    const m = SYMBOL_DECL_RE.exec(line)
    if (m !== null) {
      const name = m[1]
      return name !== undefined ? name : null
    }
    const m2 = BARE_DECL_RE.exec(line)
    if (m2 !== null) {
      const name = m2[1]
      return name !== undefined ? name : null
    }
    break
  }
  return null
}

export function buildAstNodes(
  store: GraphStore = new GraphStore(),
  opts: BuildAstOptions = {},
  projectRoot = '.',
): GraphStore {
  const source = opts.source ?? 'ast-builder'
  const extensions = opts.extensions ?? ['ts']
  const skipDirs = opts.skipDirs !== undefined ? new Set(opts.skipDirs) : DEFAULT_SKIP_DIRS

  const extSet = new Set(extensions)
  const isTs = extSet.has('ts')
  const isJava = extSet.has('java')
  const isRust = extSet.has('rust')

  if (!existsSync(projectRoot)) return store

  const files = walkFiles(projectRoot, (f) => {
    const segments = f.replace(/\\/g, '/').split('/')
    for (const seg of segments) {
      if (skipDirs.has(seg)) return false
    }
    if (isTs && TS_EXT_RE.test(f)) return true
    if (isJava && JAVA_EXT_RE.test(f)) return true
    if (isRust && RUST_EXT_RE.test(f)) return true
    return false
  })

  for (const filePath of files) {
    let text: string
    try {
      text = readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    if (!ANNOTATION_RE.test(text)) continue

    const relPath = relative(projectRoot, filePath)
    const annotations = extractAnnotations(text)

    for (const ann of annotations) {
      const symbolId = `SYMBOL:${relPath}:${ann.symbolName}`

      const fileId = `FILE:${relPath}`
      const fileNode: GraphNode = { id: fileId, kind: 'FILE', attrs: { path: relPath, source } }
      store.upsertNode(fileNode)

      store.upsertNode({
        id: symbolId,
        kind: 'SYMBOL',
        attrs: { name: ann.symbolName, path: relPath, source },
      })

      for (const invId of ann.invIds) {
        if (!store.hasNode(invId)) {
          store.upsertNode({ id: invId, kind: 'INV', attrs: { source: 'ast-stub' } })
        }

        const edge: GraphEdge = {
          from: symbolId,
          to: invId,
          kind: 'implements',
          attrs: { source },
        }
        store.addEdge(edge)
      }
    }
  }

  return store
}
