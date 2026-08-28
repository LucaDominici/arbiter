// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CliError, runCli } from '../utils/run-cli.js'

export type ExternalModelProvider = 'codex'

export interface ExternalModelAccess {
  provider: ExternalModelProvider
  vendor: 'openai'
  available: boolean
  authenticated: boolean
  version: string | null
  error: string | null
}

export interface ExternalModelDetectionOptions {
  /** Dependency injection for tests and callers inspecting another home directory. */
  homeDir?: string
  /** Environment signal used for authentication inference; credential values are never read. */
  env?: NodeJS.ProcessEnv
}

const PROVIDER_SPECS: Record<ExternalModelProvider, { command: string; vendor: 'openai' }> = {
  codex: { command: 'codex', vendor: 'openai' },
}

const detectionCache = new Map<ExternalModelProvider, ExternalModelAccess>()

function parseVersion(stdout: string): string | null {
  return stdout.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0] ?? null
}

function hasCodexAuth(options: ExternalModelDetectionOptions): boolean {
  const env = options.env ?? process.env
  if (env.OPENAI_API_KEY !== undefined) return true
  return existsSync(join(options.homeDir ?? homedir(), '.codex', 'auth.json'))
}

export function detectExternalModel(
  provider: ExternalModelProvider,
  options: ExternalModelDetectionOptions = {},
): ExternalModelAccess {
  const cached = detectionCache.get(provider)
  if (cached !== undefined) return cached

  const spec = PROVIDER_SPECS[provider]
  try {
    const result = runCli(spec.command, ['--version'], { timeoutMs: 5_000, retries: 0 })
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
  } catch (error) {
    const access: ExternalModelAccess = {
      provider,
      vendor: spec.vendor,
      available: false,
      authenticated: false,
      version: null,
      error:
        error instanceof CliError && error.notFound
          ? 'codex CLI not found'
          : error instanceof CliError && error.timedOut
            ? 'codex CLI probe timed out'
            : 'codex CLI probe failed',
    }
    detectionCache.set(provider, access)
    return access
  }
}

export function detectExternalModels(
  providers: readonly ExternalModelProvider[] = Object.keys(
    PROVIDER_SPECS,
  ) as ExternalModelProvider[],
  options: ExternalModelDetectionOptions = {},
): ExternalModelAccess[] {
  return providers.map((provider) => detectExternalModel(provider, options))
}

export function resetExternalModelDetection(): void {
  detectionCache.clear()
}
