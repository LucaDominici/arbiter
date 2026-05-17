// SPDX-License-Identifier: Apache-2.0
import type { ProjectConfig, ProjectPreset } from './types.js'

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

  config.enableIso27001Mapping = true
  config.enableNis2Mapping = true
  config.enableGdprMapping = true
  config.enableRiskRegister = true
  config.enableEvidenceHarness = true
  config.enableOperationsHandbook = true
  config.enableMcpFallback = true
  config.enableEnterpriseComplianceBaseline = true
  config.enableGdprErasureRunbook = true
  config.contractIntegrity = {
    gates: {
      openapiSnapshot: true,
      dtoParity: true,
      operationSmoke: true,
      deadCode: true,
      testHygiene: true,
    },
  }

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
