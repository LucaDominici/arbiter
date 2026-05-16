// SPDX-License-Identifier: Apache-2.0

const warned = new Set<string>()

/**
 * Emits a one-time stderr deprecation warning for the given symbol.
 * Subsequent calls with the same name are no-ops.
 * @deprecated consumers should call this on deprecated code paths.
 */
export function warnDeprecated(name: string, removeIn: string): void {
  if (warned.has(name)) return
  warned.add(name)
  process.stderr.write(
    `[arbiter] DEPRECATED: "${name}" is deprecated and will be removed in ${removeIn}. See docs/DEPRECATIONS.md.\n`,
  )
}
