// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { writeFile, resolvedPath } from './fs.js'
import { getLogger } from './logger.js'

/**
 * Add a devDependency to the target project's package.json if absent, so an
 * emitted `npx <tool>` gate resolves at install time. Single-writer; a no-op when
 * package.json is absent, unparseable, or the dependency is already present.
 * Routes the write through the fs façade (honours `--dry-run` and the
 * direct-write gate). Shared by the tool-config generators (jscpd, stylelint, …)
 * so each does not re-implement the read-modify-write (DRY, CANON-22).
 */
export function injectDevDependency(
  targetDir: string,
  name: string,
  version: string,
  dryRun: boolean,
): void {
  if (dryRun) return
  const pkgPath = resolvedPath(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    getLogger().warn(
      'pkg.inject_devdep_parse_failed',
      { path: pkgPath, name, err: String(err) },
      'injectDevDependency: failed to parse package.json',
    )
    return
  }
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
  if (!devDeps[name]) {
    devDeps[name] = version
    pkg.devDependencies = devDeps
    writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', { dryRun })
  }
}
