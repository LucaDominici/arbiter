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

const { entryPath, kind, config, targetDir, templateRoot } = workerData as WorkerData
const port = parentPort as MessagePort

async function run(): Promise<void> {
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
        return ejs.render(src, data)
      },
    }
    const generateFn = plugin['generate'] as (
      c: PluginContext,
    ) => PluginResult | Promise<PluginResult>
    const result = await generateFn(ctx)
    port.postMessage({ kind: 'result', value: result })
  }
}

run().catch((err: unknown) => {
  port.postMessage({
    kind: 'error',
    message: err instanceof Error ? err.message : String(err),
  })
})
