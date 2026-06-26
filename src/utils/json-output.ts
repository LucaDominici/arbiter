// SPDX-License-Identifier: Apache-2.0
export type JsonStatus = 'ok' | 'warning' | 'error'
type JsonErrorClass = 'recoverable' | 'fatal' | 'config'

interface JsonEnvelope {
  command: string
  version: '1'
  status: JsonStatus
  data: Record<string, unknown>
  errors?: string[]
  warnings?: string[]
  errorClass?: JsonErrorClass
}

export interface JsonOutputOpts {
  warnings?: string[]
  errorClass?: JsonErrorClass
}

/**
 * Emit a structured JSON envelope to stdout. The caller is responsible for
 * calling `process.exit()` (typically via `statusToExitCode`) if needed;
 * this function only writes output and does NOT exit.
 */
export function jsonOutput(
  command: string,
  status: JsonStatus,
  data: Record<string, unknown>,
  errors?: string[],
  opts?: JsonOutputOpts,
): void {
  const envelope: JsonEnvelope = {
    command,
    version: '1',
    status,
    data,
    ...(errors !== undefined && errors.length > 0 ? { errors } : {}),
    ...(opts?.warnings !== undefined && opts.warnings.length > 0
      ? { warnings: opts.warnings }
      : {}),
    ...(opts?.errorClass !== undefined ? { errorClass: opts.errorClass } : {}),
  }
  process.stdout.write(JSON.stringify(envelope) + '\n')
}

/**
 * Map a JSON envelope status to the project's canonical CLI exit-code convention:
 *
 *   0 = ok               — CI must pass.
 *   1 = warning          — CI should pass but surface a flag (advisory).
 *   2 = error / blocker  — CI must fail (hard stop).
 *
 * Use this helper for commands whose pass/warn/fail map cleanly onto the
 * `JsonStatus` triple (diff, configure, init, plugin, etc.).
 *
 * Commands with richer verdict spaces (e.g. `review plan`'s PASS/WARN/FAIL,
 * `review code`'s blocker-vs-warning split) compute exit codes directly and
 * intentionally diverge — but they MUST still obey the canonical convention
 * (0 / 1 / 2 ↔ ok / warning / error). See `docs/REFERENCE/CLI.md` §Exit codes.
 */
export function statusToExitCode(status: JsonStatus): number {
  if (status === 'error') return 2
  if (status === 'warning') return 1
  return 0
}
