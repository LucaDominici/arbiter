// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { injectDevDependency } from '../utils/pkg.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface BoundariesGeneratorResult {
  files: WriteResult[]
}

type DeclaredArchitecture = NonNullable<ProjectConfig['architecture']>

interface BoundariesElement {
  type: string
  pattern: string
}

interface BoundariesElementTypeRule {
  from: string
  allow: string[]
}

/**
 * #2834: convert the declared `components`/`deny` config into the shape
 * eslint-plugin-boundaries expects — `boundaries/element-types` is an
 * allow-list model (default disallow, then explicit allow per `from`), while
 * `architecture.deny` is a deny-list ("a -> b" forbidden, everything else
 * permitted). One edge not listed is a no-op, never a violation — mirrors
 * the "adding a file never fails the build" rule from the config docs.
 */
export function toBoundariesRules(architecture: DeclaredArchitecture): {
  elements: BoundariesElement[]
  elementTypeRules: BoundariesElementTypeRule[]
} {
  const names = Object.keys(architecture.components)
  const elements = names.flatMap((name) =>
    (architecture.components[name] ?? []).map((pattern) => ({ type: name, pattern })),
  )
  const deniedFrom = new Map<string, Set<string>>()
  for (const edge of architecture.deny) {
    const [from, to] = edge.split('->').map((s) => s.trim())
    if (from === undefined || to === undefined) continue
    const denied = deniedFrom.get(from) ?? new Set<string>()
    if (to === '*') {
      for (const name of names) denied.add(name)
    } else {
      denied.add(to)
    }
    deniedFrom.set(from, denied)
  }
  const elementTypeRules = names.map((name) => ({
    from: name,
    allow: names.filter((other) => other !== name && !deniedFrom.get(name)?.has(other)),
  }))
  return { elements, elementTypeRules }
}

export function generateEslintBoundaries(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): BoundariesGeneratorResult {
  if (config.language !== 'typescript' && config.language !== 'multi') return { files: [] }

  const base = config.targetDir
  const data = config

  if (config.archetype === 'frontend-spa') {
    // The gate runs the flat config (ESLint v9 removed the legacy --no-eslintrc/-c
    // loader the .cjs file needs — #1491-class fix, mirrors eslint.config.static.mjs).
    // eslint-plugin-boundaries is what the flat config's rules resolve against —
    // inject it so a fresh init does not RED on `Cannot find package` (#1835-class
    // fix, mirrors the Java BDD dep injection in behavioral-tests.ts).
    injectDevDependency(base, 'eslint-plugin-boundaries', '^7.0.2', opts.dryRun)
    return {
      files: [
        writeFile(
          resolvedPath(base, '.eslintrc-frontend-spa.cjs'),
          renderTemplate('boundaries/.eslintrc-frontend-spa.cjs.ejs', data),
          { skipIfExists: true, dryRun: opts.dryRun },
        ),
        writeFile(
          resolvedPath(base, 'eslint.config.frontend-spa.mjs'),
          renderTemplate('boundaries/eslint.config.frontend-spa.mjs.ejs', data),
          { skipIfExists: true, dryRun: opts.dryRun },
        ),
      ],
    }
  }

  // #2834: a declared `architecture` section stands on its own — the project
  // is telling us its own components, not asking for the hexagonal default.
  // Without one, the hexagonal-style gate is unchanged (regression zero).
  if (config.architectureStyle !== 'hexagonal' && !config.architecture) return { files: [] }

  // #2272: the gate runs the flat config (ESLint v9 removed the legacy
  // --no-eslintrc/-c loader the .cjs file needs — #1491-class fix, mirrors the
  // frontend-spa fix above). eslint-plugin-boundaries is what the flat config's
  // rules resolve against — inject it so a fresh init does not RED on
  // `Cannot find package` (#1835-class fix).
  injectDevDependency(base, 'eslint-plugin-boundaries', '^7.0.2', opts.dryRun)
  const templateData = config.architecture
    ? { ...data, architecture: toBoundariesRules(config.architecture) }
    : data
  return {
    files: [
      writeFile(
        resolvedPath(base, '.eslintrc-boundaries.cjs'),
        renderTemplate('boundaries/.eslintrc-boundaries.cjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'eslint.config.boundaries.mjs'),
        renderTemplate('boundaries/eslint.config.boundaries.mjs.ejs', templateData),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'scripts/check-boundaries.mjs'),
        renderTemplate('boundaries/check-boundaries.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
