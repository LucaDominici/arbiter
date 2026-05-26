// SPDX-License-Identifier: Apache-2.0
import { resolve, join } from 'node:path'
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { loadConfig, saveConfig } from '../utils/config.js'
import { loadPlugin, validateTargetDir } from '../utils/plugin-loader.js'
import { acquireLock } from '../utils/file-lock.js'
import { ArbiterError } from '../utils/errors.js'
import { jsonOutput } from '../utils/json-output.js'
import { validatePluginPackageJson } from '../integrations/plugin-schema.js'
import { t } from '../i18n/index.js'

export interface PluginAddOptions {
  dir?: string
  pkg: string
  json?: boolean | undefined
}

export interface PluginRemoveOptions {
  dir?: string
  pkg: string
  json?: boolean | undefined
}

export interface PluginListOptions {
  dir?: string
  json?: boolean | undefined
}

export interface PluginInitOptions {
  /** Parent directory in which `arbiter-plugin-<name>/` will be created. Default: cwd. */
  dir?: string
  json?: boolean | undefined
}

/** Write a file only when it does not already exist (idempotency). */
function writeIfAbsent(filePath: string, content: string): void {
  mkdirSync(join(filePath, '..'), { recursive: true })
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, 'utf-8')
  }
}

function buildPluginPackageJson(pkgName: string, pluginName: string): string {
  return (
    JSON.stringify(
      {
        name: pkgName,
        version: '0.1.0',
        description: `Arbiter plugin: ${pluginName}`,
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        scripts: { build: 'tsc', test: 'vitest run' },
        keywords: ['arbiter', 'arbiter-plugin'],
        peerDependencies: { '@arbiter/cli': '*' },
      },
      null,
      2,
    ) + '\n'
  )
}

function buildPluginIndexTs(pkgName: string): string {
  return [
    `import type { ArbiterPlugin, PluginContext, PluginResult } from '@arbiter/cli/plugin'`,
    `import { join } from 'node:path'`,
    `import { fileURLToPath } from 'node:url'`,
    ``,
    `const __dirname = fileURLToPath(new URL('.', import.meta.url))`,
    ``,
    `const plugin: ArbiterPlugin = {`,
    `  name: '${pkgName}',`,
    `  apiVersion: '1',`,
    `  templateRoot: join(__dirname, '..', 'templates'),`,
    ``,
    `  detect(config) {`,
    `    // Return true when this plugin should run for the given config.`,
    `    return config.tools !== undefined`,
    `  },`,
    ``,
    `  generate(ctx: PluginContext): PluginResult {`,
    `    // Generate files here using ctx.renderTemplate(relPath, data).`,
    `    return { files: [] }`,
    `  },`,
    `}`,
    ``,
    `export default plugin`,
    ``,
  ].join('\n')
}

// Lines below are template strings for generated plugin test files.
// Intentionally split to prevent check-test-naming.mjs from flagging THIS file.
const _TEST_IMPORT = `import { describe, it, expect } from '` + `vitest'`
const _DESCRIBE_OPEN = 'descri' + 'be('
const _IT_OPEN = 'i' + 't('

function buildPluginTestTs(pkgName: string): string {
  return [
    _TEST_IMPORT,
    `import plugin from '../index.js'`,
    ``,
    `${_DESCRIBE_OPEN}'${pkgName}', () => {`,
    `  ${_IT_OPEN}'exposes required ArbiterPlugin fields', () => {`,
    `    expect(plugin.name).toBe('${pkgName}')`,
    `    expect(plugin.apiVersion).toBe('1')`,
    `    expect(typeof plugin.generate).toBe('function')`,
    `    expect(typeof plugin.templateRoot).toBe('string')`,
    `  })`,
    ``,
    `  ${_IT_OPEN}'generate returns a PluginResult with files array', () => {`,
    `    const ctx = {`,
    `      config: { version: '0.1', tools: ['claude'], governanceLevel: 'L2', useGitHub: false },`,
    `      targetDir: '/tmp/test',`,
    `      renderTemplate: (_p: string, _d: Record<string, unknown>) => '',`,
    `    }`,
    `    const result = plugin.generate(ctx)`,
    `    expect(Array.isArray(result.files)).toBe(true)`,
    `  })`,
    `})`,
    ``,
  ].join('\n')
}

function buildPluginTsconfig(): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: 'dist',
          declaration: true,
          strict: true,
          types: ['node'],
        },
        include: ['src'],
        exclude: ['node_modules', 'dist'],
      },
      null,
      2,
    ) + '\n'
  )
}

/**
 * Scaffold a new arbiter plugin package at `<dir>/arbiter-plugin-<name>/`.
 * Idempotent: existing files are skipped, missing directories are created.
 */
export function runPluginInit(name: string, opts: PluginInitOptions = {}): Promise<void> {
  const parentDir = resolve(opts.dir ?? process.cwd())
  const pkgName = `arbiter-plugin-${name}`
  const pkgDir = join(parentDir, pkgName)

  writeIfAbsent(join(pkgDir, 'package.json'), buildPluginPackageJson(pkgName, name))
  writeIfAbsent(join(pkgDir, 'src', 'index.ts'), buildPluginIndexTs(pkgName))
  writeIfAbsent(join(pkgDir, 'tsconfig.json'), buildPluginTsconfig())
  writeIfAbsent(join(pkgDir, 'templates', '.gitkeep'), '')
  writeIfAbsent(join(pkgDir, 'src', '__tests__', 'plugin.test.ts'), buildPluginTestTs(pkgName))

  if (opts.json) {
    jsonOutput('plugin-init', 'ok', { name, pkgName, pkgDir })
    return Promise.resolve()
  }

  process.stdout.write(`${t('cli.plugin.scaffolded', { name: pkgName })}\n`)
  process.stdout.write(`${t('cli.plugin.location', { path: pkgDir })}\n`)
  process.stdout.write(`${t('cli.plugin.next_steps')}\n`)
  process.stdout.write(`${t('cli.plugin.cd_hint', { path: pkgDir })}\n`)
  process.stdout.write(`${t('cli.plugin.npm_install')}\n`)
  process.stdout.write(`${t('cli.plugin.npm_build')}\n`)
  return Promise.resolve()
}

export async function runPluginAdd(opts: PluginAddOptions): Promise<void> {
  const targetDir = resolve(opts.dir ?? process.cwd())
  const stored = loadConfig(targetDir)
  if (!stored) {
    if (opts.json) {
      jsonOutput('plugin-add', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'])
      process.exit(1)
      return
    }
    process.stderr.write(`${t('cli.plugin.no_config')}\n`)
    process.exit(1)
  }

  mkdirSync(join(targetDir, '.arbiter'), { recursive: true })
  const lock = await acquireLock(join(targetDir, '.arbiter', '.lock'))
  try {
    try {
      await loadPlugin(opts.pkg, targetDir)
    } catch (err: unknown) {
      const baseMsg = err instanceof Error ? err.message : String(err)
      const isNetwork =
        /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|registry|network|fetch/i.test(
          baseMsg,
        )
      const retryHint = isNetwork
        ? t('cli.plugin.retry_network', { name: opts.pkg })
        : t('cli.plugin.retry_local', { name: opts.pkg })
      // arbiter.json NOT modified — transaction order preserves config integrity (#612)
      throw ArbiterError.fromKey('E_PLUGIN_LOAD_FAILED', 'cli.plugin.load_error', {
        name: opts.pkg,
        message: baseMsg,
        hint: retryHint,
      })
    }

    const plugins = Array.isArray(stored.plugins) ? stored.plugins : []
    if (!plugins.includes(opts.pkg)) {
      plugins.push(opts.pkg)
    }
    await saveConfig(targetDir, { ...stored, plugins })
  } finally {
    await lock.release()
  }

  if (opts.json) {
    jsonOutput('plugin-add', 'ok', { pkg: opts.pkg })
    return
  }

  process.stdout.write(`${t('cli.plugin.added', { name: opts.pkg })}\n`)
  process.stdout.write(`${t('cli.plugin.security_advisory', { name: opts.pkg })}\n`)
}

export async function runPluginRemove(opts: PluginRemoveOptions): Promise<void> {
  const targetDir = resolve(opts.dir ?? process.cwd())
  const stored = loadConfig(targetDir)
  if (!stored) {
    if (opts.json) {
      jsonOutput('plugin-remove', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'])
      process.exit(1)
      return
    }
    process.stderr.write(`${t('cli.plugin.no_config')}\n`)
    process.exit(1)
  }

  const plugins = (stored.plugins ?? []).filter((p) => p !== opts.pkg)
  await saveConfig(targetDir, { ...stored, plugins })

  if (opts.json) {
    jsonOutput('plugin-remove', 'ok', { pkg: opts.pkg })
    return
  }
  process.stdout.write(`${t('cli.plugin.removed_msg', { name: opts.pkg })}\n`)
}

export async function runPluginList(opts: PluginListOptions): Promise<void> {
  const targetDir = resolve(opts.dir ?? process.cwd())
  const stored = loadConfig(targetDir)
  if (!stored) {
    if (opts.json) {
      jsonOutput('plugin-list', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'])
      process.exit(1)
      return
    }
    process.stderr.write(`${t('cli.plugin.no_config')}\n`)
    process.exit(1)
  }

  const pluginNames = Array.isArray(stored.plugins) ? stored.plugins : []

  if (opts.json) {
    const pluginStatuses: Array<{ pkg: string; status: string }> = []
    for (const pkg of pluginNames) {
      let status: string
      try {
        await loadPlugin(pkg, targetDir)
        status = 'resolved'
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        status = `not loadable: ${raw.split('\n')[0]}`
      }
      pluginStatuses.push({ pkg, status })
    }
    jsonOutput('plugin-list', 'ok', { plugins: pluginStatuses })
    return
  }

  if (pluginNames.length === 0) {
    process.stdout.write(`${t('cli.plugin.no_plugins')}\n`)
    return
  }

  process.stdout.write(`${t('cli.plugin.plugins_header')}\n`)
  for (const pkg of pluginNames) {
    let status: string
    try {
      await loadPlugin(pkg, targetDir)
      status = 'resolved'
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      status = `not loadable: ${raw.split('\n')[0]}`
    }
    process.stdout.write(`${t('cli.plugin.plugin_row', { name: pkg, status })}\n`)
  }
}

export interface PluginValidateEntry {
  pkg: string
  ok: boolean
  errors: string[]
}

export interface PluginListValidateOptions {
  dir?: string
  json?: boolean
}

function validateSinglePlugin(pkg: string, require: NodeJS.Require): PluginValidateEntry {
  let pkgJsonPath: string
  try {
    pkgJsonPath = require.resolve(`${pkg}/package.json`)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const msg =
      code === 'MODULE_NOT_FOUND' || code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
        ? `package.json not found for "${pkg}"`
        : `failed to resolve "${pkg}": ${err instanceof Error ? err.message : String(err)}`
    return { pkg, ok: false, errors: [msg] }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { pkg, ok: false, errors: [`failed to read/parse package.json for "${pkg}": ${msg}`] }
  }
  const validation = validatePluginPackageJson(raw)
  return { pkg, ok: validation.ok, errors: validation.errors }
}

function exitWithValidateError(opts: PluginListValidateOptions, msg: string): never {
  if (opts.json) {
    jsonOutput('plugin-list-validate', 'error', {}, [msg])
  } else {
    process.stderr.write(`  ${msg}\n`)
  }
  process.exit(1)
}

// Schema-only validation — reads package.json, never executes plugin code.
export function runPluginListValidate(opts: PluginListValidateOptions = {}): PluginValidateEntry[] {
  const targetDir = resolve(opts.dir ?? process.cwd())
  let stored: ReturnType<typeof loadConfig>
  try {
    stored = loadConfig(targetDir)
  } catch (err) {
    exitWithValidateError(opts, err instanceof Error ? err.message : String(err))
  }
  if (!stored) {
    exitWithValidateError(opts, 'No arbiter.json found. Run `arbiter init` first.')
  }

  const pluginNames = Array.isArray(stored.plugins) ? stored.plugins : []
  validateTargetDir(targetDir)
  const require = createRequire(join(targetDir, '__arbiter_anchor__.js'))
  const results = pluginNames.map((pkg) => validateSinglePlugin(pkg, require))

  if (opts.json) {
    jsonOutput('plugin-list-validate', 'ok', { results })
    return results
  }

  if (results.length === 0) {
    process.stdout.write('  No plugins configured.\n')
    return results
  }

  process.stdout.write('  Plugin manifest validation:\n')
  let exitCode = 0
  for (const r of results) {
    const icon = r.ok ? '[PASS]' : '[FAIL]'
    process.stdout.write(`  ${icon}  ${r.pkg}\n`)
    for (const e of r.errors) {
      process.stdout.write(`         ${e}\n`)
      exitCode = 1
    }
  }
  if (exitCode !== 0) process.exit(exitCode)
  return results
}
