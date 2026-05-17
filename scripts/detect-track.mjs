#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Shared track-detection library for arbiter post-commit hooks (#724).
// Pure function — no I/O, no child_process.

export const TRACK_PATTERNS = {
  FE_RE: /\.(tsx?|jsx?|vue|svelte|css|scss)$|^(web|frontend)\//,
  BE_RE: /\.(go|py|java|rs|rb)$|^(api|backend|server|cmd)\//,
  DOCS_RE: /\.md$|^docs\//,
}

/**
 * Classify a list of file paths into tracks.
 * CRLF bytes are stripped before matching (git diff --name-only can emit CRLF on Windows).
 *
 * @param {string[]} files
 * @returns {{ tracks: string[], hasFE: boolean, hasBE: boolean, hasDocs: boolean }}
 */
export function detectTracks(files) {
  const normalized = files.map((f) => f.replace(/\r/g, ''))
  const hasFE = normalized.some((f) => TRACK_PATTERNS.FE_RE.test(f))
  const hasBE = normalized.some((f) => TRACK_PATTERNS.BE_RE.test(f))
  const hasDocs = normalized.some((f) => TRACK_PATTERNS.DOCS_RE.test(f))
  const tracks = []
  if (hasFE) tracks.push('frontend')
  if (hasBE) tracks.push('backend')
  if (hasDocs) tracks.push('docs')
  return { tracks, hasFE, hasBE, hasDocs }
}
