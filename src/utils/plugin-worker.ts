// SPDX-License-Identifier: Apache-2.0
import { workerData, parentPort, type MessagePort } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ejs from 'ejs'
import type { ArbiterConfig } from '../utils/config.js'
import type { PluginContext, PluginResult } from '../types/plugin.js'

interface WorkerData {
  entryPath: string
  kind: 'generate' | 'detect'
  config: ArbiterConfig
  targetDir: string
  templateRoot: string
}

const port = parentPort as MessagePort

/** Ordinal SSOT mirror of `LEVEL_ORDER` in `../config/levels.ts` — NOT imported,
 * see the inline-duplication rationale below `withPluginRenderDefaults`. */
const LEVEL_ORDER = ['L1', 'L2', 'L3', 'L4'] as const

/**
 * Plugin-template render defaults: the #1348 `basePackage` own-key guard plus
 * the `isL2Plus`/`isL3Plus`/`isL4` level booleans injected for arbiter-shipped
 * templates by `withLevelBooleans` (`./render.ts`, #1720/#1516 ordinal SSOT).
 *
 * Kept as a deliberate inline SSOT-mirror, NOT imported from `./render.ts`:
 * this worker entry runs under tsx, where a relative `./render.js` import is
 * not rewritten to `render.ts` and fails with "Cannot find module render.js"
 * (#1552 re-confirmed: the fold breaks the worker). Plugin templates never
 * had these booleans before and no arbiter-shipped template renders through
 * this path (#1751) — this only takes effect once a plugin template opts in.
 *
 * Always returns a shallow copy (never mutates the caller's object).
 */
export function withPluginRenderDefaults(data: Record<string, unknown>): Record<string, unknown> {
  const withBasePackage = Object.prototype.hasOwnProperty.call(data, 'basePackage')
    ? data
    : { ...data, basePackage: undefined }
  const level = (withBasePackage as { governanceLevel?: unknown }).governanceLevel
  const rank = typeof level === 'string' ? LEVEL_ORDER.indexOf(level as (typeof LEVEL_ORDER)[number]) : -1
  return {
    ...withBasePackage,
    isL2Plus: rank >= LEVEL_ORDER.indexOf('L2'),
    isL3Plus: rank >= LEVEL_ORDER.indexOf('L3'),
    isL4: level === 'L4',
  }
}

async function run(): Promise<void> {
  const { entryPath, kind, config, targetDir, templateRoot } = workerData as WorkerData
  const rawMod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>
  const plugin = (rawMod['default'] ?? rawMod['plugin']) as Record<string, unknown>

  if (kind === 'detect') {
    const detectFn = plugin['detect'] as (c: unknown) => boolean | Promise<boolean>
    const result = await detectFn(config)
    port.postMessage({ kind: 'result', value: result })
  } else {
    const ctx: PluginContext = {
      config,
      targetDir,
      renderTemplate(relPath: string, data: Record<string, unknown>): string {
        const absPath = join(templateRoot, relPath)
        const src = readFileSync(absPath, 'utf-8')
        return ejs.render(src, withPluginRenderDefaults(data))
      },
    }
    const generateFn = plugin['generate'] as (
      c: PluginContext,
    ) => PluginResult | Promise<PluginResult>
    const result = await generateFn(ctx)
    port.postMessage({ kind: 'result', value: result })
  }
}

if (workerData) {
  run().catch((err: unknown) => {
    port.postMessage({
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  })
}
