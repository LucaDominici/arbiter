// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CliError, runCli } from '../utils/run-cli.js'

type ExternalModelProvider = 'codex'

interface ExternalModelAccess {
  provider: ExternalModelProvider
  vendor: 'openai'
  available: boolean
  authenticated: boolean
  version: string | null
  error: string | null
}

interface ExternalModelDetectionOptions {
  /** Dependency injection for tests and callers inspecting another home directory. */
  homeDir?: string
  /** Environment retained for compatibility; authentication comes from Codex auth-file presence. */
  env?: NodeJS.ProcessEnv
}

interface ExternalModelProviderSpec {
  command: string
  versionArgs: readonly string[]
  vendor: 'openai'
  /** Authentication is inferred from a local Codex auth-file signal; credential values are never read. */
  authSignal: string
  installHint: string
}

const PROVIDER_SPECS: Record<ExternalModelProvider, ExternalModelProviderSpec> = {
  codex: {
    command: 'codex',
    versionArgs: ['--version'],
    vendor: 'openai',
    authSignal: '~/.codex/auth.json presence (inference; openai/codex#10233)',
    installHint: 'Install the Codex CLI: https://github.com/openai/codex',
  },
}

const detectionCache = new Map<ExternalModelProvider, ExternalModelAccess>()

function parseVersion(stdout: string): string | null {
  return stdout.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0] ?? null
}

function hasCodexAuth(options: ExternalModelDetectionOptions): boolean {
  // Authentication is inferred from presence only; the Codex auth caveat is tracked in openai/codex#10233.
  return existsSync(join(options.homeDir ?? homedir(), '.codex', 'auth.json'))
}

/**
 * Budget for the `--version` availability probe. Five seconds is ample on an idle machine and is
 * kept as the default, but this is a WALL-CLOCK probe against a spawned process: on a loaded CI
 * box, spawn latency alone can exceed it, and the provider is then reported unavailable for a
 * reason that has nothing to do with the provider (#2501). The seat silently degrades and the
 * caller sees an empty result, which is indistinguishable from "codex is not installed".
 * Tunable so a slow environment can raise it without patching the default for everyone.
 */
function probeTimeoutMs(options: ExternalModelDetectionOptions): number {
  const raw = (options.env ?? process.env)['ARBITER_EXTERNAL_PROBE_TIMEOUT_MS']
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000
}

function detectExternalModel(
  provider: ExternalModelProvider,
  options: ExternalModelDetectionOptions = {},
): ExternalModelAccess {
  const cached = detectionCache.get(provider)
  if (cached !== undefined) return cached

  const spec = PROVIDER_SPECS[provider]
  try {
    const result = runCli(spec.command, [...spec.versionArgs], {
      timeoutMs: probeTimeoutMs(options),
      retries: 0,
    })
    const authenticated = hasCodexAuth(options)
    const access: ExternalModelAccess = {
      provider,
      vendor: spec.vendor,
      available: true,
      authenticated,
      version: parseVersion(result.stdout),
      error: authenticated ? null : 'Not authenticated',
    }
    detectionCache.set(provider, access)
    return access
    // FAIL-OPEN-INTENT: provider probe failure is recorded as unavailable so the caller can apply its explicit degrade/fail policy.
  } catch (error) {
    const access: ExternalModelAccess = {
      provider,
      vendor: spec.vendor,
      available: false,
      authenticated: false,
      version: null,
      error:
        error instanceof CliError && error.notFound
          ? `${spec.command} CLI not found — ${spec.installHint}`
          : error instanceof CliError && error.timedOut
            ? 'codex CLI probe timed out'
            : 'codex CLI probe failed',
    }
    detectionCache.set(provider, access)
    return access
  }
}

function detectExternalModels(
  providers: readonly ExternalModelProvider[] = Object.keys(
    PROVIDER_SPECS,
  ) as ExternalModelProvider[],
  options: ExternalModelDetectionOptions = {},
): ExternalModelAccess[] {
  return providers.map((provider) => detectExternalModel(provider, options))
}

function resetExternalModelDetection(): void {
  detectionCache.clear()
}

export {
  type ExternalModelAccess,
  detectExternalModel,
  detectExternalModels,
  resetExternalModelDetection,
}
