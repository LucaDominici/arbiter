// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

/** Mint a sortable ID: `<prefix>-YYYYMMDD-HHMMSS-<Nhex>`. */
export function mintId(prefix: string, hexBytes = 2): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const time = now.toISOString().slice(11, 19).replace(/:/g, '')
  return `${prefix}-${date}-${time}-${randomBytes(hexBytes).toString('hex')}`
}

/** Like mintId but avoids collision with existing dirs. */
export function mintUniqueId(prefix: string, targetDir: string, hexBytes = 2): string {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = mintId(prefix, hexBytes)
    const dir = join(targetDir, '.arbiter', 'plan', 'runs', id)
    if (!existsSync(dir)) return id
  }
  return mintId(prefix, hexBytes)
}

/**
 * Returns the current run's trace ID. Minted once per process and stored in
 * `process.env.ARBITER_RUN_ID` so subprocesses inherit it automatically.
 */
export function getRunId(): string {
  if (!process.env['ARBITER_RUN_ID']) {
    process.env['ARBITER_RUN_ID'] = mintId('arb', 4)
  }
  return process.env['ARBITER_RUN_ID']
}

/** Error message footer with the run ID for correlation. */
export function formatRunIdFooter(): string {
  return `\nRun ID: ${getRunId()}`
}
