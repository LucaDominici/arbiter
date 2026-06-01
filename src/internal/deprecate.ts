// SPDX-License-Identifier: Apache-2.0

import type { DeprecatedFlagRecord } from './cli-deprecation-registry.js'

export interface DeprecatedFlagFilterResult {
  remaining: string[]
  exitCode?: number
  errorMessage?: string
}

/**
 * Scans argv for deprecated flags defined in the registry.
 * warn-stage:   emits stderr notice, passes flag through.
 * hide-stage:   emits stderr notice, strips flag from remaining argv.
 * remove-stage: returns exitCode=1 with an error message.
 */
export function applyDeprecatedFlagFilter(
  argv: string[],
  registry: readonly DeprecatedFlagRecord[],
): DeprecatedFlagFilterResult {
  const remaining: string[] = []

  for (const arg of argv) {
    // Support both --flag and --flag=value forms
    const eqIdx = arg.indexOf('=')
    const flagName = eqIdx === -1 ? arg : arg.slice(0, eqIdx)
    const record = registry.find((r) => r.flag === flagName)
    if (record === undefined) {
      remaining.push(arg)
      continue
    }

    if (record.stage === 'remove') {
      return {
        remaining: argv,
        exitCode: 1,
        errorMessage:
          `[arbiter] "${record.flag}" was removed in ${record.removeIn}. ` +
          `Use "${record.replacement}" instead. See docs/DEPRECATIONS.md.`,
      }
    }

    process.stderr.write(
      `[arbiter] DEPRECATED: "${record.flag}" is deprecated (since ${record.deprecatedIn}, ` +
        `removed in ${record.removeIn}). Use "${record.replacement}" instead.\n`,
    )

    if (record.stage === 'warn') {
      remaining.push(arg)
    }
    // hide-stage: drop the flag (not pushed to remaining)
  }

  return { remaining }
}
