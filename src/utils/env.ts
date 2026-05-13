/**
 * Shared environment-variable parsing helpers.
 *
 * Used by config layers (env-overrides) and the CLI entrypoint to agree
 * on what counts as a truthy/falsy env value. Centralised here so a new
 * boolean env var doesn't need to invent its own truthy-string set.
 */

/**
 * Canonical boolean parser for env vars.
 *
 * Truthy: "true", "1", "yes", "on" (case-insensitive, trimmed)
 * Falsy:  "false", "0", "no", "off"
 * Any other value (including empty) → undefined.
 *
 * Returning undefined lets the caller decide whether absence/malformed
 * means "use the default" or "warn the user".
 */
export function parseBooleanEnv(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
  return undefined
}
