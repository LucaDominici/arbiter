// SPDX-License-Identifier: Apache-2.0
import type { ProjectConfig, ProjectPreset } from './types.js'
import { levelAtLeast } from '../config/levels.js'

/** Meta-presets selectable via `--preset` (excludes the no-op 'none'). */
const SELECTABLE_PRESETS: readonly ProjectPreset[] = ['industrial-grade', 'solo-homelab']

/**
 * Validates a raw `--preset` CLI string into a known {@link ProjectPreset}.
 * Returns `undefined` for unknown or absent values so the caller can fall back
 * to the 'none' no-op (an invalid preset must never silently apply a bundle).
 */
export function resolvePresetOption(raw: string | undefined): ProjectPreset | undefined {
  if (raw === undefined) return undefined
  return SELECTABLE_PRESETS.find((p) => p === raw)
}

/**
 * Applies a meta-preset to a ProjectConfig in place.
 * Auth and observability providers are left as 'none' — the caller
 * overrides them via --auth-provider / --observability-provider flags.
 * If auth/observability are already set (non-none provider), the provider
 * is preserved; only missing fields are filled in.
 */
export function applyPreset(preset: ProjectPreset, config: ProjectConfig): void {
  if (preset === 'none') return

  config.preset = preset

  if (preset === 'solo-homelab') {
    applySoloHomelab(config)
    return
  }

  config.enableIso27001Mapping = true
  config.enableNis2Mapping = true
  config.enableGdprMapping = true
  config.enableRiskRegister = true
  config.enableEvidenceHarness = true
  config.enableOperationsHandbook = true
  config.enableMcpFallback = true

  config.auth = {
    provider: 'none',
    tenantIsolation: true,
    ...config.auth,
  }

  config.observability = {
    provider: 'none',
    metrics: true,
    logs: true,
    traces: false,
    alerts: true,
    ...config.observability,
  }
}

const SOLO_HOMELAB_MAX_GOVERNANCE = 'L2'

/**
 * #1313 — solo-homelab meta-preset. Strips the compliance/audit weight that a
 * single-operator homelab project never needs: the compliance mapping pack
 * (ISO 27001 / GDPR / NIS2 / risk register), any industry overlay
 * (sox/pharma/gdpr STRIDE/RACI), mutation testing, the evidence harness, and the
 * production operations handbook (no prod runbooks). Governance is clamped to a
 * ceiling of L2 — L3/L4 ceremony is out of scope for a homelab.
 */
function applySoloHomelab(config: ProjectConfig): void {
  config.enableIso27001Mapping = false
  config.enableNis2Mapping = false
  config.enableGdprMapping = false
  config.enableRiskRegister = false
  config.industryOverlay = 'none'
  config.enableMutationTesting = false
  config.enableEvidenceHarness = false
  config.enableOperationsHandbook = false

  if (levelAtLeast(config.governanceLevel, 'L3')) {
    config.governanceLevel = SOLO_HOMELAB_MAX_GOVERNANCE
  }
}
