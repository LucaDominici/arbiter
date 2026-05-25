// SPDX-License-Identifier: Apache-2.0
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { ArbiterPlugin, PluginResult } from '../types/plugin.js'
import { ArbiterError } from './errors.js'

const VALID_NAME_RE = /^[a-z0-9][a-z0-9-_]*$/
const DEFAULT_TIMEOUT_MS = 60_000
// Shared no-op for suppress-only promise chains (e.g. worker.terminate())
const noop = (): void => {}

export interface LoadPluginOptions {
  invokeTimeoutMs?: number
}

// pathToFileURL was previously used for createRequire anchors but encodes '#' as
// '%23', causing require.resolve to look in a non-existent percent-encoded directory.
// createRequire(string) accepts raw fs paths directly — no URL conversion needed.
function validateTargetDir(targetDir: string): void {
  for (const ch of targetDir) {
    const code = ch.charCodeAt(0)
    if (code < 32 || code === 127) {
      throw new Error(`invalid targetDir: contains NUL, control character, or DEL`)
    }
  }
  if (process.platform !== 'win32' && targetDir.includes('\\')) {
    throw new Error(`invalid targetDir: contains backslash (use forward slashes on POSIX)`)
  }
}

function resolveWorkerPath(): { path: string; execArgv: string[] } {
  const url = import.meta.url
  if (url.endsWith('.ts')) {
    const tsxLoader = fileURLToPath(new URL('../../node_modules/tsx/dist/esm/index.mjs', url))
    return {
      path: fileURLToPath(new URL('./plugin-worker.ts', url)),
      execArgv: ['--import', tsxLoader],
    }
  }
  return { path: fileURLToPath(new URL('./plugin-worker.js', url)), execArgv: [] }
}

function invokeInWorker(
  entryPath: string,
  kind: 'generate' | 'detect',
  payload: { config: unknown; targetDir: string; templateRoot: string },
  name: string,
  timeoutMs: number,
): Promise<unknown> {
  const { path: workerPath, execArgv } = resolveWorkerPath()
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { entryPath, kind, ...payload },
      execArgv,
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
      env: {},
    })

    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      try {
        fn()
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }

    const timer = setTimeout(() => {
      void worker.terminate().then(noop, noop)
      settle(() => {
        reject(
          ArbiterError.fromKey('E_PLUGIN_TIMEOUT', 'cli.plugin.timeout', { name, ms: timeoutMs }),
        )
      })
    }, timeoutMs)

    const onSignal = (): void => {
      void worker.terminate().then(noop, noop)
      settle(() => {
        reject(ArbiterError.fromKey('E_PLUGIN_INTERRUPTED', 'cli.plugin.interrupted', { name }))
      })
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)

    worker.once('message', (msg: { kind: string; value?: unknown; message?: string }) => {
      settle(() => {
        if (msg.kind === 'error') {
          reject(new Error(`Plugin "${name}" error: ${msg.message}`))
        } else {
          resolve(msg.value)
        }
      })
    })

    worker.once('error', (err: Error) => {
      settle(() => {
        reject(err)
      })
    })

    worker.once('exit', (code: number) => {
      settle(() => {
        reject(
          code !== 0
            ? ArbiterError.fromKey('E_PLUGIN_CRASHED', 'cli.plugin.crashed', { name, code })
            : new Error(`Plugin "${name}" exited without returning a result`),
        )
      })
    })
  })
}

async function loadRawMod(
  require: NodeJS.Require,
  entry: string,
): Promise<Record<string, unknown>> {
  try {
    const loaded = require(entry) as unknown
    if (loaded === null || typeof loaded !== 'object') {
      throw new Error('Plugin must export a default object.')
    }
    return loaded as Record<string, unknown>
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ERR_REQUIRE_ESM') throw err
    return (await import(pathToFileURL(entry).href)) as Record<string, unknown>
  }
}

export async function loadPlugin(
  pkg: string,
  targetDir: string,
  opts?: LoadPluginOptions,
): Promise<ArbiterPlugin> {
  validateTargetDir(targetDir)
  const timeoutMs = opts?.invokeTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const require = createRequire(join(targetDir, '__arbiter_anchor__.js'))
  let entry: string
  try {
    entry = require.resolve(pkg)
  } catch (err) {
    const isNotFound =
      err instanceof Error && (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND'
    if (isNotFound) {
      throw new Error(
        `Plugin "${pkg}" not found in ${targetDir}/node_modules. Install it first: npm install ${pkg}`,
        { cause: err },
      )
    }
    throw new Error(
      `Plugin "${pkg}" failed to resolve: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
  // Prefer CJS require for metadata extraction: avoids pathToFileURL encoding
  // '#' as '%23', which breaks Vite's module resolver in test environments.
  // Falls back to dynamic import for ESM-only plugins (ERR_REQUIRE_ESM).
  const rawMod = await loadRawMod(require, entry)
  const plugin = rawMod['default'] ?? rawMod['plugin'] ?? rawMod
  validatePluginShape(plugin, pkg)
  const p = plugin as Record<string, unknown>
  const pluginName = p['name'] as string
  const templateRoot = p['templateRoot'] as string
  const hasDetect = typeof p['detect'] === 'function'
  const verifyPlanRules = Array.isArray(p['verifyPlanRules'])
    ? (p['verifyPlanRules'] as ArbiterPlugin['verifyPlanRules'])
    : undefined

  const proxy: ArbiterPlugin = {
    name: pluginName,
    apiVersion: '1',
    templateRoot,
    ...(verifyPlanRules !== undefined ? { verifyPlanRules } : {}),
    generate(ctx) {
      return invokeInWorker(
        entry,
        'generate',
        { config: ctx.config, targetDir: ctx.targetDir, templateRoot },
        pluginName,
        timeoutMs,
      ) as Promise<PluginResult>
    },
  }

  if (hasDetect) {
    proxy.detect = (config): Promise<boolean> =>
      invokeInWorker(
        entry,
        'detect',
        { config, targetDir, templateRoot },
        pluginName,
        timeoutMs,
      ) as Promise<boolean>
  }

  return proxy
}

function validatePluginShape(plugin: unknown, pkg: string): void {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error(`Plugin "${pkg}" must export a default object.`)
  }
  const p = plugin as Record<string, unknown>
  if (typeof p['name'] !== 'string' || !VALID_NAME_RE.test(p['name'])) {
    throw new Error(
      `Plugin "${pkg}" has invalid name "${String(p['name'])}". Must match /^[a-z0-9][a-z0-9-_]*$/`,
    )
  }
  if (p['apiVersion'] !== '1') {
    throw new Error(`Plugin "${pkg}" requires apiVersion "1", got "${String(p['apiVersion'])}".`)
  }
  if (typeof p['generate'] !== 'function') {
    throw new Error(`Plugin "${pkg}" is missing required generate() function.`)
  }
  if (typeof p['templateRoot'] !== 'string') {
    throw new Error(`Plugin "${pkg}" must have a string templateRoot field.`)
  }
  if ('detect' in p && typeof p['detect'] !== 'function') {
    throw new Error(`Plugin "${pkg}" detect field must be a function if present.`)
  }
  if ('verifyPlanRules' in p && !Array.isArray(p['verifyPlanRules'])) {
    throw new Error(`Plugin "${pkg}" field verifyPlanRules must be an array if present.`)
  }
}
