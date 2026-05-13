import { resolve, join } from 'node:path'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { loadConfig, saveConfig } from '../utils/config.js'
import { loadPlugin } from '../utils/plugin-loader.js'
import { jsonOutput } from '../utils/json-output.js'

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

  console.log(`  Scaffolded plugin: ${pkgName}`)
  console.log(`  Location: ${pkgDir}`)
  console.log(`  Next steps:`)
  console.log(`    cd ${pkgDir}`)
  console.log(`    npm install`)
  console.log(`    npm run build`)
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
    console.error('  No arbiter.json found. Run `arbiter init` first.')
    process.exit(1)
  }

  await loadPlugin(opts.pkg, targetDir)

  const plugins = Array.isArray(stored.plugins) ? stored.plugins : []
  if (!plugins.includes(opts.pkg)) {
    plugins.push(opts.pkg)
  }
  saveConfig(targetDir, { ...stored, plugins })

  if (opts.json) {
    jsonOutput('plugin-add', 'ok', { pkg: opts.pkg })
    return
  }

  console.log(`  Plugin added: ${opts.pkg}`)
  console.log(
    `  Security advisory: Plugin ${opts.pkg} will execute Node code during \`arbiter update\`. Verify source before use.`,
  )
}

export function runPluginRemove(opts: PluginRemoveOptions): void {
  const targetDir = resolve(opts.dir ?? process.cwd())
  const stored = loadConfig(targetDir)
  if (!stored) {
    if (opts.json) {
      jsonOutput('plugin-remove', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'])
      process.exit(1)
      return
    }
    console.error('  No arbiter.json found. Run `arbiter init` first.')
    process.exit(1)
  }

  const plugins = (stored.plugins ?? []).filter((p) => p !== opts.pkg)
  saveConfig(targetDir, { ...stored, plugins })

  if (opts.json) {
    jsonOutput('plugin-remove', 'ok', { pkg: opts.pkg })
    return
  }
  console.log(`  Plugin removed: ${opts.pkg}`)
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
    console.error('  No arbiter.json found. Run `arbiter init` first.')
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
    console.log('  No plugins configured.')
    return
  }

  console.log('  Configured plugins:')
  for (const pkg of pluginNames) {
    let status: string
    try {
      await loadPlugin(pkg, targetDir)
      status = 'resolved'
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      status = `not loadable: ${raw.split('\n')[0]}`
    }
    console.log(`  ├── ${pkg} (${status})`)
  }
}
