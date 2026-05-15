// SPDX-License-Identifier: Apache-2.0
/**
 * Cross-repo governance detectors (#264).
 *
 * Each detector takes the full list of loaded RepoData objects and returns
 * zero or more findings. Detectors are pure functions — no I/O, no side effects.
 *
 * Wave-1 graph data contains only INV and GATE nodes, so the ADR/CANON-based
 * detectors degrade gracefully when no such nodes exist.
 */

import type { CompareFinding, RepoData } from './model.js'

// ─── 1. Divergent enforcement ─────────────────────────────────────────────────

/**
 * Same INV id present in ≥2 repos but with different gate sets.
 * Only reports when both repos have the INV and the gate sets differ.
 */
export function detectDivergentEnforcement(repos: readonly RepoData[]): CompareFinding[] {
  if (repos.length < 2) return []

  // Collect all INV ids that appear in at least two repos
  const invAppearances = new Map<string, RepoData[]>()
  for (const repo of repos) {
    for (const invId of repo.invIds) {
      const list = invAppearances.get(invId) ?? []
      list.push(repo)
      invAppearances.set(invId, list)
    }
  }

  const findings: CompareFinding[] = []

  for (const [invId, reposWithInv] of invAppearances) {
    if (reposWithInv.length < 2) continue

    // Check if any pair has different gate sets
    const gateSets = reposWithInv.map((r) => {
      const gates = r.invGates.get(invId) ?? new Set<string>()
      return { repo: r, gates, key: [...gates].sort().join('|') }
    })

    const uniqueKeys = new Set(gateSets.map((g) => g.key))
    if (uniqueKeys.size <= 1) continue // All identical

    const detail = gateSets.map(
      (g) => `  ${g.repo.label}: [${[...g.gates].sort().join(', ') || '(none)'}]`,
    )

    findings.push({
      type: 'divergent-enforcement',
      invId,
      summary: `${invId} enforced differently across repos`,
      repos: reposWithInv.map((r) => r.path),
      detail,
    })
  }

  return findings
}

// ─── 2. Contradictory ADRs ────────────────────────────────────────────────────

/**
 * Same ADR id present in ≥2 repos with conflicting titles.
 *
 * Wave-1: Only INV+GATE nodes exist. ADR nodes will be contributed by a future
 * builder. When no ADR nodes are present, returns [].
 *
 * Simple heuristic: if the title in repo A starts with "Do X" and in repo B
 * starts with "Do NOT X" (negation keywords: not, never, avoid, forbid,
 * prevent), it is a candidate for contradiction.
 */
const NEGATE_RE = /\b(?:not|never|avoid|forbid|prevent)\b/i

export function detectContradictoryAdrs(repos: readonly RepoData[]): CompareFinding[] {
  if (repos.length < 2) return []

  const adrAppearances = new Map<string, RepoData[]>()
  for (const repo of repos) {
    for (const adrId of repo.adrTitles.keys()) {
      const list = adrAppearances.get(adrId) ?? []
      list.push(repo)
      adrAppearances.set(adrId, list)
    }
  }

  const findings: CompareFinding[] = []

  for (const [adrId, reposWithAdr] of adrAppearances) {
    if (reposWithAdr.length < 2) continue
    for (const finding of adrContradictions(adrId, reposWithAdr)) {
      findings.push(finding)
    }
  }

  return findings
}

function adrContradictions(adrId: string, reposWithAdr: RepoData[]): CompareFinding[] {
  const result: CompareFinding[] = []
  for (let i = 0; i < reposWithAdr.length; i++) {
    for (let j = i + 1; j < reposWithAdr.length; j++) {
      const repoA = reposWithAdr[i]
      const repoB = reposWithAdr[j]
      if (repoA === undefined || repoB === undefined) continue
      const titleA = repoA.adrTitles.get(adrId) ?? ''
      const titleB = repoB.adrTitles.get(adrId) ?? ''
      if (titleA !== titleB && NEGATE_RE.test(titleA) !== NEGATE_RE.test(titleB)) {
        result.push({
          type: 'contradictory-adr',
          invId: adrId,
          summary: `${adrId} titles conflict across repos`,
          repos: [repoA.path, repoB.path],
          detail: [`  ${repoA.label}: "${titleA}"`, `  ${repoB.label}: "${titleB}"`],
        })
      }
    }
  }
  return result
}

// ─── 3. Promotion asymmetry ───────────────────────────────────────────────────

/**
 * INV present in one repo but no corresponding node in another.
 * This is a superset of unique-to-one-repo but framed as a
 * "you should promote this" recommendation.
 *
 * For Wave-1 this is equivalent to unique-to-one-repo for INV nodes.
 */
export function detectPromotionAsymmetry(repos: readonly RepoData[]): CompareFinding[] {
  if (repos.length < 2) return []

  // Build the union of all INV ids
  const allInvIds = new Set<string>()
  for (const repo of repos) {
    for (const id of repo.invIds) allInvIds.add(id)
  }

  const findings: CompareFinding[] = []

  for (const invId of allInvIds) {
    const present = repos.filter((r) => r.invIds.has(invId))
    const absent = repos.filter((r) => !r.invIds.has(invId))

    // Only flag if present in at least one repo AND missing in at least one
    if (present.length === 0 || absent.length === 0) continue
    // Don't flag if it's a global fallback repo (from catalog) vs real graph repo
    // A fallback repo has ALL catalog INVs, so asymmetry here is noise
    const allAbsentAreFallbacks = absent.every((r) => r.fromFallback)
    if (allAbsentAreFallbacks) continue
    const allPresentAreFallbacks = present.every((r) => r.fromFallback)
    if (allPresentAreFallbacks) continue

    findings.push({
      type: 'promotion-asymmetry',
      invId,
      summary: `${invId} is enforced in ${present.map((r) => r.label).join(', ')} but absent from ${absent.map((r) => r.label).join(', ')}`,
      repos: present.map((r) => r.path),
      detail: [
        `  Present in: ${present.map((r) => r.label).join(', ')}`,
        `  Missing from: ${absent.map((r) => r.label).join(', ')}`,
      ],
    })
  }

  return findings
}

// ─── 4. Unique to one repo ────────────────────────────────────────────────────

/**
 * Invariants that appear in exactly one repo and are not in the fallback catalog.
 * These are candidates for org-wide promotion.
 */
export function detectUniqueToOneRepo(repos: readonly RepoData[]): CompareFinding[] {
  if (repos.length < 2) return []

  // Collect INV ids per repo
  const invCounts = new Map<string, Set<string>>() // invId → set of repo paths where present
  for (const repo of repos) {
    for (const invId of repo.invIds) {
      const paths = invCounts.get(invId) ?? new Set<string>()
      paths.add(repo.path)
      invCounts.set(invId, paths)
    }
  }

  const findings: CompareFinding[] = []

  for (const [invId, paths] of invCounts) {
    if (paths.size !== 1) continue // present in multiple repos — not "unique"
    const ownerPath = [...paths][0]
    if (ownerPath === undefined) continue
    const owner = repos.find((r) => r.path === ownerPath)
    if (owner === undefined || owner.fromFallback) continue // skip catalog-fallback repos

    findings.push({
      type: 'unique-to-one-repo',
      invId,
      summary: `${invId} is unique to ${owner.label} — candidate for org-wide promotion`,
      repos: [ownerPath],
      detail: [`  Owner: ${owner.label}`, `  Tier: ${owner.invTiers.get(invId) ?? 'unknown'}`],
    })
  }

  return findings
}

// ─── 5. Risk-class mapping divergence ────────────────────────────────────────

/**
 * Same INV id but assigned to different tiers across repos.
 */
export function detectRiskClassDivergence(repos: readonly RepoData[]): CompareFinding[] {
  if (repos.length < 2) return []

  const invTierGroups = new Map<string, Map<string, string[]>>() // invId → tier → [repo labels]

  for (const repo of repos) {
    for (const invId of repo.invIds) {
      const tier = repo.invTiers.get(invId) ?? 'unknown'
      const tierMap = invTierGroups.get(invId) ?? new Map<string, string[]>()
      const labels = tierMap.get(tier) ?? []
      labels.push(repo.label)
      tierMap.set(tier, labels)
      invTierGroups.set(invId, tierMap)
    }
  }

  const findings: CompareFinding[] = []

  for (const [invId, tierMap] of invTierGroups) {
    if (tierMap.size <= 1) continue // Same tier everywhere

    const detail = [...tierMap.entries()].map(([tier, labels]) => `  ${tier}: ${labels.join(', ')}`)

    findings.push({
      type: 'risk-class-divergence',
      invId,
      summary: `${invId} has different risk tiers across repos`,
      repos: repos.map((r) => r.path),
      detail,
    })
  }

  return findings
}
