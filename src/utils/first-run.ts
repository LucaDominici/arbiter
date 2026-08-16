// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { ensureDir, writeFileTranslated } from './fs.js'
import { join } from 'node:path'
import { homedir } from 'node:os'

const MARKER_REL = '.arbiter/first-run-seen'

const BANNER = `
┌─────────────────────────────────────────────────────┐
│  arbiter collects ZERO telemetry.                   │
│  No analytics. No tracking. No network calls home.  │
│  See PRIVACY.md in the generated project files.     │
└─────────────────────────────────────────────────────┘
`

/**
 * Shows a one-time telemetry-stance banner on the user's first arbiter init run.
 * Creates ~/.arbiter/first-run-seen to suppress on subsequent runs.
 *
 * @param quiet - If true, suppresses banner output (marker still written).
 * @param homeOverride - Override home directory for testing.
 */
export function showTelemetryBannerIfFirstRun(homeOverride?: string, quiet?: boolean): void
export function showTelemetryBannerIfFirstRun(homeOverride: string, quiet: boolean): void
export function showTelemetryBannerIfFirstRun(
  homeOverrideOrQuiet?: string | boolean,
  quiet?: boolean,
): void {
  let home: string
  let isQuiet: boolean

  if (typeof homeOverrideOrQuiet === 'string') {
    home = homeOverrideOrQuiet
    isQuiet = quiet ?? false
  } else {
    home = homedir()
    isQuiet = homeOverrideOrQuiet ?? false
  }

  const markerPath = join(home, MARKER_REL)

  if (existsSync(markerPath)) return

  ensureDir(join(home, '.arbiter'))
  writeFileTranslated(markerPath, new Date().toISOString())

  if (!isQuiet) {
    process.stderr.write(BANNER)
  }
}
