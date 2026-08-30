// SPDX-License-Identifier: Apache-2.0
/**
 * `.arbiterignore` (#2353) — the consumer's per-file opt-out from the generator.
 *
 * A consumer that wants ONE upstream fix (a security hook, a labels file) had no
 * supported way to take it without re-syncing its whole generated surface: a bare
 * `arbiter update` rematerializes every manifest entry, and the only workaround was
 * to `arbiter diff --json` and hand-copy content out of a throwaway rendered clone.
 *
 * ONE mechanism, two directions:
 *   - `.arbiterignore` at the repo root — gitignore syntax, PERMANENT, honoured by
 *     both `update` and `diff`;
 *   - `update --only <glob>` — the inverse allowlist, for a SINGLE run.
 * `.arbiterignore` wins on conflict: a standing, committed decision outranks one
 * invocation's flag.
 *
 * Patterns match MANIFEST KEYS — the targetDir-relative posix path under which a
 * generated file is tracked in `.arbiter-generated-manifest.json`, which is the id
 * the file is known by everywhere else in arbiter (adopt policy, retirement,
 * emission parity). There is deliberately no separate generator-key namespace: a
 * glob (`docs/**`, `.github/workflows/**`) already selects a generator's output,
 * and a second id space would be a second thing to keep in sync.
 *
 * Enforced at the single write chokepoint (`resolveWriteAction` in `utils/fs.ts`),
 * NOT by filtering the generator registry: an unemitted file is an UNVISITED
 * manifest key, and `planRetirement` treats those as retirement/stale candidates —
 * an opt-out that deletes files is the opposite of an opt-out.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { globMatch } from '../conformance/shared.js'

export const IGNORE_FILE_NAME = '.arbiterignore'

/**
 * What the write chokepoint should do with one managed-file key.
 * `deselected` is "outside this run's `--only`"; `ignored` is "the repo declined it".
 * Kept distinct so the report can name the mechanism that decided.
 */
export type SelectionVerdict = 'emit' | 'ignored' | 'deselected'

/**
 * Read the repo-root `.arbiterignore`, in file order (order matters — last match
 * wins). Blank lines and `#` comments are dropped, the rest trimmed. A missing or
 * unreadable file yields no patterns: the opt-out is opt-in, never fail-closed.
 */
export function loadIgnorePatterns(targetDir: string): string[] {
  const path = join(targetDir, IGNORE_FILE_NAME)
  if (!existsSync(path)) return []
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
    // FAIL-OPEN-INTENT: an unreadable .arbiterignore must not stop `update` — no patterns means arbiter manages everything, the pre-#2353 behaviour.
  } catch {
    return []
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/**
 * Expand ONE gitignore pattern into the restricted globs {@link globMatch} understands:
 * leading `/` anchors to the repo root, a trailing `/` matches only inside the
 * directory, a pattern with no `/` matches at any depth, and a plain token also
 * covers everything beneath it (`scripts` ⇒ `scripts` and `scripts/**`).
 */
function patternGlobs(pattern: string): string[] {
  const dirOnly = pattern.endsWith('/')
  const stripped = dirOnly ? pattern.slice(0, -1) : pattern
  const anchored = stripped.startsWith('/')
  const body = anchored ? stripped.slice(1) : stripped
  if (body.length === 0) return []
  const base = anchored || body.includes('/') ? body : `**/${body}`
  return dirOnly ? [`${base}/**`] : [base, `${base}/**`]
}

function matchesPattern(pattern: string, key: string): boolean {
  return patternGlobs(pattern).some((glob) => globMatch(glob, key))
}

/**
 * Does `.arbiterignore` decline this managed-file key? Gitignore precedence: every
 * pattern is evaluated in order and the LAST one that matches decides, so a `!`
 * negation re-includes a file an earlier pattern excluded (and a later re-listing
 * excludes it again).
 */
export function isIgnored(patterns: string[], key: string): boolean {
  let ignored = false
  for (const raw of patterns) {
    const negated = raw.startsWith('!')
    const pattern = negated ? raw.slice(1) : raw
    if (matchesPattern(pattern, key)) ignored = !negated
  }
  return ignored
}

/** Is this key inside `update --only`'s allowlist? Plain globs, no negation. */
export function matchesOnly(globs: string[], key: string): boolean {
  return globs.some((glob) => matchesPattern(glob, key))
}

/**
 * The selection predicate threaded into a generation session. Ignore is checked
 * FIRST so a committed `.arbiterignore` can never be overridden by a `--only` on
 * the command line.
 */
export function buildSelectionPredicate(opts: {
  patterns: string[]
  only: string[]
}): (key: string) => SelectionVerdict {
  return (key: string): SelectionVerdict => {
    if (isIgnored(opts.patterns, key)) return 'ignored'
    if (opts.only.length > 0 && !matchesOnly(opts.only, key)) return 'deselected'
    return 'emit'
  }
}
