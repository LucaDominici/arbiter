// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { mutatePackageJson } from '../utils/pkg.js'
import { formatContent } from '../utils/prettier-format.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ApiMiddlewareGeneratorResult {
  files: WriteResult[]
}

function injectExpressPackageJson(targetDir: string, dryRun: boolean): void {
  mutatePackageJson(targetDir, dryRun, (pkg) => {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
    let changed = false
    if (!deps['express']) {
      deps['express'] = '^5.1.0'
      pkg.dependencies = deps
      changed = true
    }
    if (!devDeps['@types/express']) {
      devDeps['@types/express'] = '^5.0.3'
      pkg.devDependencies = devDeps
      changed = true
    }
    if (!devDeps['supertest']) {
      devDeps['supertest'] = '^7.1.4'
      pkg.devDependencies = devDeps
      changed = true
    }
    if (!devDeps['@types/supertest']) {
      devDeps['@types/supertest'] = '^6.0.3'
      pkg.devDependencies = devDeps
      changed = true
    }
    return changed
  })
}

export function generateApiMiddleware(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ApiMiddlewareGeneratorResult {
  if (!config.hasPublicApi) return { files: [] }

  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config

  if (config.language === 'typescript' || config.language === 'multi') {
    injectExpressPackageJson(base, opts.dryRun)
    // #1840 F4 tranche-3: formatContent (#933 F13) reformats these hand-authored
    // (single-quote/no-semi) templates to the TARGET project's own .prettierrc
    // BEFORE writing — without it, any project whose prettier config differs from
    // arbiter's internal style (the common case: e.g. semi:true/singleQuote:false)
    // fails its own generated `format` gate on arbiter's OWN middleware, surfaced
    // while promoting the backend-web-db archetype's TS fixture to functional tier.
    const middlewareFiles: [string, string][] = [
      ['deprecation.ts', 'middleware/deprecation.ts.ejs'],
      ['410-gone-handler.ts', 'middleware/410-gone-handler.ts.ejs'],
      ['error-handler.ts', 'middleware/error-handler.ts.ejs'],
      ['correlation-id.ts', 'middleware/correlation-id.ts.ejs'],
      ['payload-size-limit.ts', 'middleware/payload-size-limit.ts.ejs'],
    ]
    for (const [filename, tmpl] of middlewareFiles) {
      const path = resolvedPath(base, 'src', 'middleware', filename)
      results.push(
        writeFile(path, formatContent(renderTemplate(tmpl, data), path, base), {
          skipIfExists: true,
          dryRun: opts.dryRun,
        }),
      )
    }
    const contractTestPath = resolvedPath(
      base,
      '__tests__',
      'contract',
      'error-shape.contract.test.ts',
    )
    results.push(
      writeFile(
        contractTestPath,
        formatContent(
          renderTemplate('__tests__/contract/error-shape.contract.test.ts.ejs', data),
          contractTestPath,
          base,
        ),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  if ((config.language === 'java' || config.language === 'multi') && config.basePackage) {
    const pkgPath = config.basePackage.replace(/\./g, '/')
    results.push(
      writeFile(
        resolvedPath(
          base,
          'src',
          'main',
          'java',
          pkgPath,
          'web',
          'interceptor',
          'DeprecationInterceptor.java',
        ),
        renderTemplate('java/DeprecationInterceptor.java.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
