// SPDX-License-Identifier: Apache-2.0
import type { Invariant } from '../../invariants/types.js'
import type { GraphNode, GraphEdge } from '../model.js'
import { GraphStore } from '../store.js'

/**
 * INV builder (#259, Wave-1).
 *
 * Reads invariant catalog entries and emits:
 *   - one INV node per entry (id == invariant id, e.g. "INV-04")
 *   - one GATE node per distinct enforcement mechanism
 *   - one INV --enforces--> GATE edge per enforcement
 *
 * Splitting rule for the `enforcement` string: we deliberately keep it
 * conservative — split on `;` only. Many catalog entries pack multiple
 * mechanisms into a single string separated by semicolons (e.g.
 * "CI (Knip); local gate: `npm run knip`"). Splitting on commas would
 * over-fragment ("CI (Knip, ESLint)" → wrong).
 *
 * An invariant with empty/missing `enforcement` produces an INV node
 * with NO outgoing edges — that is the orphan-invariant failure class
 * that `verify graph` detects.
 */

export interface BuildInvOptions {
  /** Optional builder-stamped attribute, defaults to "inv-catalog". */
  source?: string
}

const DEFAULT_SOURCE = 'inv-catalog'

export function buildInvNodes(
  invariants: readonly Invariant[],
  store: GraphStore = new GraphStore(),
  opts: BuildInvOptions = {},
): GraphStore {
  const source = opts.source ?? DEFAULT_SOURCE

  for (const inv of invariants) {
    const invNode: GraphNode = {
      id: inv.id,
      kind: 'INV',
      attrs: {
        title: inv.title,
        tier: inv.tier,
        alwaysActive: inv.alwaysActive,
        ...(inv.minGovernanceLevel !== undefined
          ? { minGovernanceLevel: inv.minGovernanceLevel }
          : {}),
        source,
      },
    }
    store.upsertNode(invNode)

    const enforcement = inv.enforcement?.trim()
    if (enforcement === undefined || enforcement === '') continue

    const mechanisms = splitEnforcement(enforcement)
    for (const mechanism of mechanisms) {
      const gateId = `GATE:${mechanism}`
      const gateNode: GraphNode = {
        id: gateId,
        kind: 'GATE',
        attrs: { mechanism, title: mechanism, source },
      }
      store.upsertNode(gateNode)

      const edge: GraphEdge = {
        from: inv.id,
        to: gateId,
        kind: 'enforces',
        attrs: { source },
      }
      store.addEdge(edge)
    }
  }

  return store
}

/**
 * Split an enforcement string into mechanism tokens.
 *
 * We split on `;` only, trim whitespace, drop empties, and de-duplicate
 * within a single string. Over-eager splitting (e.g. on commas) would
 * fragment legitimate compound mechanisms like "CI (Knip, ESLint)".
 */
export function splitEnforcement(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(';')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}
