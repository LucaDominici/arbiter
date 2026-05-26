// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { getLogger } from '../utils/logger.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ApiMiddlewareGeneratorResult {
  files: WriteResult[]
}

function injectExpressPackageJson(targetDir: string, dryRun: boolean): void {
  if (dryRun) return
  const pkgPath = resolvedPath(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    getLogger().warn(
      'api_middleware.inject_express_parse_failed',
      { path: pkgPath, err: String(err) },
      'injectExpressPackageJson: failed to parse package.json',
    )
    return
  }
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
  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  }
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
    results.push(
      writeFile(
        resolvedPath(base, 'src', 'middleware', 'deprecation.ts'),
        renderTemplate('middleware/deprecation.ts.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'src', 'middleware', '410-gone-handler.ts'),
        renderTemplate('middleware/410-gone-handler.ts.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'src', 'middleware', 'error-handler.ts'),
        renderTemplate('middleware/error-handler.ts.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'src', 'middleware', 'correlation-id.ts'),
        renderTemplate('middleware/correlation-id.ts.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'src', 'middleware', 'payload-size-limit.ts'),
        renderTemplate('middleware/payload-size-limit.ts.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, '__tests__', 'contract', 'error-shape.contract.test.ts'),
        renderTemplate('__tests__/contract/error-shape.contract.test.ts.ejs', data),
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
