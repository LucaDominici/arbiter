// SPDX-License-Identifier: Apache-2.0

import { getExperiment } from './registry.js'

export interface ParsedExperimentalArgv {
  remaining: string[]
  flags: Record<string, boolean>
}

// Supports both --experimental.<name> and --experimental.<name>=<value> forms.
// The capture group excludes '=' so "foo=true" doesn't slip through as the name.
const EXPERIMENTAL_PREFIX_RE = /^--experimental\.([^=]+)(?:=.*)?$/

/**
 * Strips --experimental.<name> tokens from argv, validates names against the
 * registry, and returns the cleaned argv alongside the enabled-flags map.
 * Throws on unknown experiment names so the CLI can exit with an error message.
 */
export function parseExperimentalArgv(argv: string[]): ParsedExperimentalArgv {
  const remaining: string[] = []
  const flags: Record<string, boolean> = {}

  for (const arg of argv) {
    const match = EXPERIMENTAL_PREFIX_RE.exec(arg)
    if (match !== null) {
      const name = match[1] ?? ''
      getExperiment(name) // throws if unknown
      flags[name] = true
    } else {
      remaining.push(arg)
    }
  }

  return { remaining, flags }
}
