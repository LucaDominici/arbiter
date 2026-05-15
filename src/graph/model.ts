// SPDX-License-Identifier: Apache-2.0
/**
 * Provenance Graph — core model (#259).
 *
 * The graph captures the chain of evidence that links governance artefacts
 * (invariants, ADRs, requirements, canon rules) to the code that implements
 * them, the tests that prove them and the gates that enforce them.
 *
 * Wave-1 (this file) defines only the *primitive* types. The store, query
 * and command layers are stateless over these types — adding new node or
 * edge kinds later is a closed-set extension (string literal union).
 */

/**
 * The nine node kinds. Closed set — extending this requires updating every
 * builder/renderer that switches on `Node['kind']`.
 *
 *  - INV       — invariant catalog entry (e.g. INV-04)
 *  - ADR       — architecture decision record (e.g. ADR-040)
 *  - REQ       — requirement / spec item
 *  - CANON     — canon rule (e.g. CANON-16)
 *  - FILE      — source file path
 *  - SYMBOL    — exported symbol or function within a file
 *  - TEST      — test case
 *  - EVIDENCE  — generated artefact (gate result, SUMMARY.json, etc.)
 *  - GATE      — gate / enforcement mechanism (CI job, hook, lint rule)
 */
export type NodeKind =
  | 'INV'
  | 'ADR'
  | 'REQ'
  | 'CANON'
  | 'FILE'
  | 'SYMBOL'
  | 'TEST'
  | 'EVIDENCE'
  | 'GATE'

/**
 * The eight edge kinds. Closed set.
 *
 *  - enforces    — GATE enforces INV/CANON/ADR
 *  - decides     — ADR decides a question / scope (-> INV/REQ)
 *  - demands     — REQ demands an INV/ADR
 *  - implements  — FILE/SYMBOL implements an INV/REQ/ADR
 *  - proves      — TEST proves an INV/REQ
 *  - produces    — GATE produces EVIDENCE
 *  - supersedes  — newer node supersedes an older one
 *  - promotes    — gate run promotes a tool/language tier (matrix)
 */
export type EdgeKind =
  | 'enforces'
  | 'decides'
  | 'demands'
  | 'implements'
  | 'proves'
  | 'produces'
  | 'supersedes'
  | 'promotes'

/**
 * A node is a tagged record. The `id` is the unique key (e.g. "INV-04",
 * "ADR-040", "src/graph/model.ts"). `attrs` carries free-form metadata
 * (title, description, governance level, file path) — typed as `unknown`
 * so callers must narrow.
 *
 * Temporal fields added in #263 (time-travel governance):
 *   - `created_at` — ISO timestamp of first observed creation (optional)
 *   - `commit_ref`  — git SHA of the commit that introduced this node (optional)
 * Both fields are optional for backwards compatibility: existing snapshots
 * without these fields continue to deserialise correctly.
 */
export interface GraphNode {
  readonly id: string
  readonly kind: NodeKind
  readonly attrs: Readonly<Record<string, unknown>>
  /** ISO 8601 timestamp of the first observed creation of this node. Optional. */
  readonly created_at?: string
  /** Git commit SHA that introduced this node. Optional. */
  readonly commit_ref?: string
}

/**
 * An edge is a directed kind-tagged link between two nodes referenced by id.
 * `attrs` is reserved for edge-specific metadata (e.g. confidence, source
 * builder); the empty-object case is the default.
 */
export interface GraphEdge {
  readonly from: string
  readonly to: string
  readonly kind: EdgeKind
  readonly attrs: Readonly<Record<string, unknown>>
}

/** The fully-materialised graph — what builders produce and the store wraps. */
export interface GraphSnapshot {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

/** All node kinds as a runtime-iterable tuple — useful for validation. */
export const ALL_NODE_KINDS: readonly NodeKind[] = [
  'INV',
  'ADR',
  'REQ',
  'CANON',
  'FILE',
  'SYMBOL',
  'TEST',
  'EVIDENCE',
  'GATE',
] as const

/** All edge kinds as a runtime-iterable tuple. */
export const ALL_EDGE_KINDS: readonly EdgeKind[] = [
  'enforces',
  'decides',
  'demands',
  'implements',
  'proves',
  'produces',
  'supersedes',
  'promotes',
] as const

export function isNodeKind(value: string): value is NodeKind {
  return (ALL_NODE_KINDS as readonly string[]).includes(value)
}

export function isEdgeKind(value: string): value is EdgeKind {
  return (ALL_EDGE_KINDS as readonly string[]).includes(value)
}
