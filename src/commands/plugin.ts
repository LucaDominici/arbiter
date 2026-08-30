// SPDX-License-Identifier: Apache-2.0
// #2416: minimal `arbiter plugin add`/`arbiter plugin list`. ADR-031 designed a CLI
// subcommand for the plugin API (`add | remove | list`) but it was never registered
// in cli.ts, leaving three public docs (website/recipes/plugin.md,
// website/recipes/custom-invariant.md, examples/plugins/spring-boot/README.md) and
// CONTRIBUTING.md instructing a command that didn't exist. This ships `add` and
// `list` only — no scaffolder (`plugin init`), no `remove` (nothing in scope cites
// it); see docs/internal/ADR/118-plugin-add-ship-minimal.md.
import { resolve, join } from 'node:path'
import { loadConfig, saveConfig } from '../utils/config.js'
import { loadPlugin } from '../utils/plugin-loader.js'
import { detectPackageManager } from '../detectors/package-manager.js'
import type { PackageManager } from '../detectors/package-manager.js'
import { runCli } from '../utils/run-cli.js'
import { acquireLock } from '../utils/file-lock.js'
import { ensureDir } from '../utils/fs.js'
import { jsonOutput } from '../utils/json-output.js'
import { ArbiterError } from '../utils/errors.js'
import { t } from '../i18n/index.js'

export interface PluginAddOptions {
  dir?: string | undefined
  pkg: string
  install: boolean
  json?: boolean | undefined
}

export interface PluginListOptions {
  dir?: string | undefined
  json?: boolean | undefined
}

/** Node's own bare-specifier-vs-path convention: a `.` or `/` prefix is a path. */
function isLocalSpec(pkg: string): boolean {
  return pkg.startsWith('.') || pkg.startsWith('/')
}

/** Strip a trailing `@version` from an npm install spec (scoped-package-safe). */
function packageNameOf(spec: string): string {
  const at = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.indexOf('@')
  return at === -1 ? spec : spec.slice(0, at)
}

const INSTALL_ARGS: Record<PackageManager, (spec: string) => string[]> = {
  npm: (spec) => ['install', '--save-dev', spec],
  pnpm: (spec) => ['add', '--save-dev', spec],
  yarn: (spec) => ['add', '--dev', spec],
  bun: (spec) => ['add', '--dev', spec],
}

function configNotFoundError(): ArbiterError {
  return ArbiterError.fromKey(
    'E_CONFIG_NOT_FOUND',
    'errors.E_CONFIG_NOT_FOUND',
    {},
    { hint: 'Run `arbiter init` to initialize governance in this directory.' },
  )
}

export async function runPluginAdd(options: PluginAddOptions): Promise<void> {
  const targetDir = resolve(options.dir ?? process.cwd())
  const stored = loadConfig(targetDir)
  if (!stored) {
    if (options.json) {
      jsonOutput('plugin add', 'error', {}, [t('cli.plugin.no_config')])
      process.exit(1)
      return
    }
    throw configNotFoundError()
  }

  const spec = options.pkg
  const local = isLocalSpec(spec)
  const name = local ? spec : packageNameOf(spec)

  if (!local && options.install) {
    const pm = detectPackageManager(targetDir)
    runCli(pm.name, INSTALL_ARGS[pm.name](spec), { cwd: targetDir, timeoutMs: 180_000 })
  }

  try {
    await loadPlugin(name, targetDir)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (options.json) {
      jsonOutput('plugin add', 'error', { name }, [message])
      process.exit(1)
      return
    }
    throw ArbiterError.fromKey('E_PLUGIN_UNRESOLVABLE', 'cli.plugin.load_error', {
      name,
      message,
      hint: 'Verify the package name or path is correct and that it is installed.',
    })
  }

  const existing = stored.plugins ?? []
  const alreadyConfigured = existing.includes(name)
  const plugins = alreadyConfigured
    ? existing
    : [...existing, name].sort((a, b) => a.localeCompare(b))

  if (!alreadyConfigured) {
    ensureDir(join(targetDir, '.arbiter'))
    const lock = await acquireLock(join(targetDir, '.arbiter', '.lock'))
    try {
      await saveConfig(targetDir, { ...stored, plugins })
    } finally {
      await lock.release()
    }
  }

  if (options.json) {
    jsonOutput('plugin add', 'ok', { name, added: !alreadyConfigured, plugins })
    return
  }
  if (alreadyConfigured) {
    process.stdout.write(`${t('cli.plugin.already_configured', { name })}\n`)
    return
  }
  process.stdout.write(`${t('cli.plugin.added', { name })}\n`)
  process.stdout.write(`${t('cli.plugin.security_advisory', { name })}\n`)
}

type PluginStatus = 'loaded' | 'not found' | 'error'

async function loadStatus(name: string, targetDir: string): Promise<PluginStatus> {
  try {
    await loadPlugin(name, targetDir)
    return 'loaded'
    // `plugin list` is a report over every configured entry, so one unresolvable plugin must
    // render as its own row rather than abort the listing of the ones that do load (ADR-118).
    // FAIL-OPEN-INTENT: not swallowed — the returned `not found`/`error` status IS the surface.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return /not found/i.test(message) ? 'not found' : 'error'
  }
}

export async function runPluginList(options: PluginListOptions): Promise<void> {
  const targetDir = resolve(options.dir ?? process.cwd())
  const stored = loadConfig(targetDir)
  if (!stored) {
    if (options.json) {
      jsonOutput('plugin list', 'error', {}, [t('cli.plugin.no_config')])
      process.exit(1)
      return
    }
    throw configNotFoundError()
  }

  const names = stored.plugins ?? []
  const plugins: { name: string; status: PluginStatus }[] = []
  for (const name of names) {
    plugins.push({ name, status: await loadStatus(name, targetDir) })
  }

  if (options.json) {
    jsonOutput('plugin list', 'ok', { plugins })
    return
  }

  if (plugins.length === 0) {
    process.stdout.write(`${t('cli.plugin.no_plugins')}\n`)
    return
  }
  process.stdout.write(`${t('cli.plugin.plugins_header')}\n`)
  for (const p of plugins) {
    process.stdout.write(`${t('cli.plugin.plugin_row', { name: p.name, status: p.status })}\n`)
  }
}
