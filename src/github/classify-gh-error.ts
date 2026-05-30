// SPDX-License-Identifier: Apache-2.0
import { CliError } from '../utils/run-cli.js'

export type GhErrorKind = 'recoverable' | 'fatal' | 'config'

// Substrings in stderr that indicate unrecoverable authentication/network failure.
// Lowercase only — matched against the lowercased error text.
const FATAL_PATTERNS = [
  'bad credentials',
  'token has been revoked',
  'authentication token not found',
  'token not found',
  'not logged in',
  'gh auth login',
  'http 401',
  '401 unauthorized',
]

/**
 * Classify a gh API error as recoverable (continue, aggregate), fatal (halt
 * immediately, exit 2), or config (gh binary missing, exit 78).
 *
 * Allow-list strategy: explicit recoverable patterns first; explicit fatal
 * patterns second; everything else defaults to recoverable so a single unknown
 * error does not abort the full provisioning run.
 */
export function classifyGhError(err: unknown): GhErrorKind {
  if (!(err instanceof CliError)) return 'recoverable'

  if (err.notFound) return 'config'

  if (err.timedOut) return 'fatal'

  const text = `${err.stderr} ${err.stdout}`.toLowerCase()

  if (FATAL_PATTERNS.some((p) => text.includes(p))) return 'fatal'

  // Recoverable: permission/resource errors that don't stop auth
  if (
    text.includes('must have admin') ||
    text.includes('resource not accessible') ||
    text.includes('not accessible by personal access token') ||
    text.includes('already exists') ||
    text.includes('http 404') ||
    text.includes('404 not found')
  ) {
    return 'recoverable'
  }

  return 'recoverable'
}
