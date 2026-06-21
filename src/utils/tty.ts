// SPDX-License-Identifier: Apache-2.0
// utils/tty.ts — terminal colour-capability detection for rich console output (#1475, epic #1469).
//
// CANON-16 survey: no existing stdout colour helper — the repo's isTTY uses are stdin prompts
// (cli.ts, confirm-downgrade.ts) and self-validation.mjs hard-codes raw ANSI (always-on, .mjs).
// This is the single shared gate so glyph/ANSI output only ever appears on a real terminal and never
// in a piped/CI/committed artifact (byte-determinism).

/** A writable stream we can probe for TTY-ness (process.stdout/stderr satisfy this). */
export interface TtyStream {
  isTTY?: boolean
}

/**
 * True when ANSI colour is safe to emit on `stream`: a real TTY, with NO_COLOR unset, not in CI, and
 * TERM not 'dumb'. Honors the https://no-color.org convention. Piped/CI/redirected output ⇒ false ⇒
 * the caller emits a byte-deterministic, ANSI-free rendering.
 */
export function colorEnabled(
  stream: TtyStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    Boolean(stream.isTTY) &&
    env['NO_COLOR'] === undefined &&
    env['CI'] === undefined &&
    env['TERM'] !== 'dumb'
  )
}

/**
 * True when output must be pure ASCII (no unicode glyphs): an explicit request, or a C/POSIX locale
 * whose terminal cannot be trusted to render multi-byte glyphs. Independent of colour.
 */
export function asciiOnly(explicit: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (explicit) return true
  const lang = env['LC_ALL'] || env['LC_CTYPE'] || env['LANG'] || ''
  return lang === 'C' || lang === 'POSIX'
}

/** SGR reset + a tiny palette. Only ever applied when colorEnabled() is true. */
const SGR = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
} as const

export type Sgr = keyof typeof SGR

/**
 * Wrap `text` in an SGR colour when `on`, else return it unchanged (ANSI-free). An out-of-palette
 * `color` (e.g. resolved from an untrusted/prototype map key) is a no-op — never emits `undefined`
 * + a dangling reset.
 */
export function paint(text: string, color: Sgr, on: boolean): string {
  if (!on || !Object.hasOwn(SGR, color)) return text
  return `${SGR[color]}${text}${SGR.reset}`
}
