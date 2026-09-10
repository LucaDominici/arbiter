// SPDX-License-Identifier: Apache-2.0

export type EvidenceCompletionPolicy = 'exact-pr' | 'reviewed-pr' | 'direct' | 'legacy'

export type EvidenceCompletionPolicyResolution =
  | { ok: true; policy: EvidenceCompletionPolicy }
  | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function refusal(reason: string): EvidenceCompletionPolicyResolution {
  return { ok: false, reason }
}

function rawPermitGitHub(config: Record<string, unknown>): boolean {
  return config['permitGitHub'] === true
}

/**
 * Resolve the completion route from stored config without applying compatibility defaults.
 * The exact-SHA watcher has a separate mutation contract in scripts/lib/exact-sha-policy.mjs.
 */
export function resolveEvidenceCompletionPolicy(rawConfig: unknown): EvidenceCompletionPolicyResolution {
  if (!isRecord(rawConfig)) return refusal('completion policy requires an object arbiter.json')
  const features = rawConfig['features']
  if (!isRecord(features)) return refusal('completion policy requires an object features config')
  if (features['evidenceHarness'] !== true) return { ok: true, policy: 'legacy' }

  const mode = rawConfig['collaborationMode']
  if (mode === 'peer-review' || mode === 'gated-review') {
    return rawPermitGitHub(rawConfig)
      ? { ok: true, policy: 'reviewed-pr' }
      : refusal('reviewed completion requires raw permitGitHub: true')
  }
  if (mode !== 'trunk-solo') {
    return refusal('completion policy requires an explicit supported collaborationMode')
  }
  const solo = rawConfig['solo']
  if (!isRecord(solo)) return refusal('trunk-solo completion requires an explicit solo.mergeMode')
  if (solo['mergeMode'] === 'direct') return { ok: true, policy: 'direct' }
  if (solo['mergeMode'] === 'pr-ff') {
    return rawPermitGitHub(rawConfig)
      ? { ok: true, policy: 'exact-pr' }
      : refusal('exact completion requires raw permitGitHub: true')
  }
  return refusal('trunk-solo completion requires solo.mergeMode direct or pr-ff')
}
