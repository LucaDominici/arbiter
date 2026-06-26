// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { writeFile, resolvedPath } from './fs.js'
import { getLogger } from './logger.js'

/**
 * Reject volatile local install channels (#1314): a `file:`/`link:`/`portal:`
 * specifier or a local `.tgz`/`.tar.gz` path is machine- and time-specific — it
 * resolves on the author's box but breaks `npm install` for anyone else weeks
 * later (the haben AF-003 failure). Governed projects invoke arbiter via `npx`
 * and pin every injected tool to a registry version, so a volatile spec reaching
 * this single choke-point is a generator bug — fail loudly rather than emit a
 * package.json that will rot. (Option C; a registry/pinned-tag channel is the
 * future A-flip, tracked separately.)
 */
function assertNonVolatileVersion(name: string, version: string): void {
  const volatile = /^(file:|link:|portal:)/.test(version) || /\.(tgz|tar\.gz)$/.test(version)
  if (volatile) {
    throw new Error(
      `injectDevDependency: refusing volatile install channel for "${name}": "${version}". ` +
        `file:/link:/portal: specifiers and local .tgz paths are machine- and time-specific and ` +
        `break \`npm install\` for the fleet (#1314). Pin a registry version (e.g. "5.0.6") instead.`,
    )
  }
}

/**
 * The single read-modify-write choke-point for a target project's package.json.
 * Owns the whole skeleton — `existsSync` guard, parse-with-warn, and the write —
 * so no generator re-implements it (DRY, CANON-22; #1519). The write is routed
 * through the `utils/fs.ts` `writeFile` façade, which is **atomic** (temp-file +
 * rename), honours `--dry-run`, and translates errno→i18n: a crash or `ENOSPC`
 * mid-write can therefore never truncate the user's package.json (the worst file
 * to leave half-written). Calling raw `node:fs` `writeFileSync` on package.json
 * is a façade bypass — every site must go through here instead.
 *
 * No-op when `dryRun` is set, package.json is absent, or it is unparseable. The
 * caller's `mutate` callback receives the parsed object, applies its change in
 * place, and returns `true` iff it changed anything; the write fires only then,
 * so an idempotent re-run leaves the file byte-identical (no spurious rewrite).
 */
export function mutatePackageJson(
  targetDir: string,
  dryRun: boolean,
  mutate: (pkg: Record<string, unknown>) => boolean,
): void {
  if (dryRun) return
  const pkgPath = resolvedPath(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    getLogger().warn(
      'pkg.mutate_parse_failed',
      { path: pkgPath, err: String(err) },
      'mutatePackageJson: failed to parse package.json',
    )
    return
  }
  if (mutate(pkg)) {
    writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', { dryRun })
  }
}

/**
 * Add a devDependency to the target project's package.json if absent, so an
 * emitted `npx <tool>` gate resolves at install time. Single-writer; a no-op when
 * package.json is absent, unparseable, or the dependency is already present.
 * Routes the write through {@link mutatePackageJson} (atomic, dry-run-honouring).
 * Shared by the tool-config generators (jscpd, stylelint, …) so each does not
 * re-implement the read-modify-write (DRY, CANON-22).
 * Rejects volatile install channels (`file:`/`.tgz`) structurally (#1314).
 */
export function injectDevDependency(
  targetDir: string,
  name: string,
  version: string,
  dryRun: boolean,
): void {
  assertNonVolatileVersion(name, version)
  mutatePackageJson(targetDir, dryRun, (pkg) => {
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
    if (devDeps[name]) return false
    devDeps[name] = version
    pkg.devDependencies = devDeps
    return true
  })
}
