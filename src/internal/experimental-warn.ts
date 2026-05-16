// SPDX-License-Identifier: Apache-2.0

const warned = new Set<string>()

export function warnExperimental(name: string): void {
  if (warned.has(name)) return
  warned.add(name)
  process.stderr.write(
    `[arbiter] EXPERIMENTAL: "${name}" is an experimental feature and may change without notice. Enable with --experimental.${name}.\n`,
  )
}

// Test-only reset — keeps the module singleton clean between test cases.
export function _resetWarned(): void {
  warned.clear()
}
