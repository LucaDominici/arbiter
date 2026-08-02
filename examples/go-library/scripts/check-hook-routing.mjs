#!/usr/bin/env node
// CATALOG: validates the complete emitted-hook → dispatcher → settings route.
// CATALOG: stays separate from emission coherence because this script runs in governed targets.
// CATALOG: catches brownfield and user-preservation drift after update at target runtime.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const hooksDir = join(root, '.claude', 'hooks')
const dispatcherPath = join(hooksDir, 'hooks.mjs')
const settingsPath = join(root, '.claude', 'settings.json')

try {
  const owned = readOwnedHooks(root, hooksDir)
  const findings = isCodexOnly(root)
    ? inspectCodexRoutes(
        owned,
        readRequired(join(root, '.codex', 'config.toml')),
        join(root, '.codex', 'codex-adapter.mjs'),
      )
    : inspectRoutes(
        owned,
        parseHandlers(readRequired(dispatcherPath)),
        parseWiring(readRequired(settingsPath)),
        hooksDir,
      )
  if (findings.length > 0) {
    for (const finding of findings) process.stderr.write(`[hook-routing] ${finding}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `[hook-routing] PASS — ${owned.size} Arbiter-owned hooks are dispatched through wired events\n`,
  )
  process.exit(0)
} catch (error) {
  process.stderr.write(
    `[hook-routing] ERROR — ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(2)
}

function readRequired(path) {
  if (!existsSync(path)) throw new Error(`required file missing: ${path}`)
  return readFileSync(path, 'utf-8')
}

function readOwnedHooks(repoRoot, dir) {
  if (!existsSync(dir)) throw new Error(`required hooks directory missing: ${dir}`)
  const marked = markedOwnedHooks(dir)
  const generatedPath = join(repoRoot, '.arbiter-generated-manifest.json')
  if (existsSync(generatedPath)) return readGeneratedOwnedHooks(generatedPath, marked)

  const hardnessPath = join(repoRoot, '.arbiter', 'hooks-manifest.json')
  if (existsSync(hardnessPath)) return readHardnessOwnedHooks(hardnessPath)

  return normalizeOwnedPaths(marked)
}

function readGeneratedOwnedHooks(path, marked) {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'))
  validateGeneratedManifest(parsed)
  return normalizeOwnedPaths([
    ...Object.keys(parsed.files),
    ...(parsed.withheldSafety ?? []),
    ...marked,
  ])
}

function validateGeneratedManifest(parsed) {
  if (parsed?.$schemaVersion !== 1 || typeof parsed.files !== 'object' || parsed.files === null) {
    throw new Error('.arbiter-generated-manifest.json has an invalid shape')
  }
  if (
    parsed.withheldSafety !== undefined &&
    (!Array.isArray(parsed.withheldSafety) ||
      !parsed.withheldSafety.every((path) => typeof path === 'string'))
  ) {
    throw new Error('.arbiter-generated-manifest.json has invalid withheldSafety ownership')
  }
}

function readHardnessOwnedHooks(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'))
  if (parsed?.version !== 1 || !Array.isArray(parsed.hooks)) {
    throw new Error('.arbiter/hooks-manifest.json has an invalid shape')
  }
  return new Set(
    parsed.hooks
      .map((entry) => entry?.file)
      .filter((file) => typeof file === 'string' && file.endsWith('.mjs'))
      .filter((file) => file !== 'hooks.mjs' && file !== 'lib.mjs'),
  )
}

function normalizeOwnedPaths(paths) {
  return new Set(
    paths
      .filter((path) => /^\.claude\/hooks\/[^/]+\.mjs$/.test(path))
      .map((path) => path.slice('.claude/hooks/'.length))
      .filter((file) => file !== 'hooks.mjs' && file !== 'lib.mjs'),
  )
}

function markedOwnedHooks(dir) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.mjs') && file !== 'hooks.mjs' && file !== 'lib.mjs')
    .filter((file) => readFileSync(join(dir, file), 'utf-8').includes('Arbiter hook:'))
    .map((file) => `.claude/hooks/${file}`)
}

function isCodexOnly(repoRoot) {
  const path = join(repoRoot, 'arbiter.json')
  if (!existsSync(path)) return false
  const parsed = JSON.parse(readFileSync(path, 'utf-8'))
  if (!Array.isArray(parsed?.tools)) throw new Error('arbiter.json tools must be an array')
  return parsed.tools.includes('codex') && !parsed.tools.includes('claude')
}

function parseHandlers(source) {
  const block = /const HANDLERS\s*=\s*\{([\s\S]*?)\n\}\s*;?/.exec(source)
  if (!block) throw new Error('hooks.mjs has no parseable HANDLERS table')
  const handlers = new Map()
  const eventPattern = /(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*\[([\s\S]*?)\],/g
  for (const match of block[1].matchAll(eventPattern)) {
    const files = [...match[3].matchAll(/'([^']+\.mjs)'/g)].map((item) => item[1])
    handlers.set(match[1] ?? match[2], files)
  }
  if (handlers.size === 0) throw new Error('hooks.mjs HANDLERS table is empty or malformed')
  return handlers
}

function parseWiring(source) {
  const settings = JSON.parse(source)
  if (typeof settings?.hooks !== 'object' || settings.hooks === null) {
    throw new Error('settings.json has no hooks object')
  }
  const dispatcherEvents = new Set()
  const directByEvent = new Map()
  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) throw new Error(`settings hook event ${event} is not an array`)
    for (const entry of entries)
      registerSettingsEntry(event, entry, dispatcherEvents, directByEvent)
  }
  return { dispatcherEvents, directByEvent }
}

function registerSettingsEntry(event, entry, dispatcherEvents, directByEvent) {
  if (typeof entry !== 'object' || entry === null || !Array.isArray(entry.hooks)) return
  const expected =
    typeof entry.matcher === 'string' && entry.matcher !== '*' ? `${event}:${entry.matcher}` : event
  for (const hook of entry.hooks) {
    registerWiringCommand(hook?.command, expected, dispatcherEvents, directByEvent)
  }
}

function registerWiringCommand(value, expected, dispatcherEvents, directByEvent) {
  const command = typeof value === 'string' ? value : ''
  const dispatcher = /(?:^|[/ ])hooks\.mjs["']?\s+["']?([^"' ]+)["']?/.exec(command)
  if (dispatcher?.[1] === expected) dispatcherEvents.add(expected)

  const direct = /\.claude\/hooks\/([^/"' ]+\.mjs)(?:["' ]|$)/.exec(command)
  if (!direct || direct[1] === 'hooks.mjs') return
  const files = directByEvent.get(expected) ?? new Set()
  files.add(direct[1])
  directByEvent.set(expected, files)
}

function inspectRoutes(owned, handlers, wiring, dir) {
  const findings = []
  const routed = new Set()
  for (const [event, files] of handlers) {
    inspectHandlerRoute(event, files, owned, wiring, dir, findings, routed)
  }
  inspectDirectRoutes(wiring.directByEvent, dir, findings, routed)
  inspectOwnedRoutes(owned, dir, findings, routed)
  return [...new Set(findings)].sort()
}

function inspectHandlerRoute(event, files, owned, wiring, dir, findings, routed) {
  const direct = wiring.directByEvent.get(event) ?? new Set()
  const dispatcherWired = wiring.dispatcherEvents.has(event)
  const ownedFiles = files.filter((file) => owned.has(file))
  if (ownedFiles.length > 0 && !dispatcherWired && !ownedFiles.every((file) => direct.has(file))) {
    findings.push(`UNROUTED event ${event}`)
  }
  for (const file of files)
    inspectHandlerFile(event, file, owned, direct, dispatcherWired, dir, findings, routed)
}

function inspectHandlerFile(event, file, owned, direct, dispatcherWired, dir, findings, routed) {
  const wired = dispatcherWired || direct.has(file)
  if (wired) routed.add(file)
  if ((wired || owned.has(file)) && !existsSync(join(dir, file))) {
    findings.push(`MISSING handler ${file} for ${event}`)
  }
}

function inspectDirectRoutes(directByEvent, dir, findings, routed) {
  for (const [event, files] of directByEvent) {
    for (const file of files) {
      routed.add(file)
      if (!existsSync(join(dir, file))) findings.push(`MISSING direct hook ${file} for ${event}`)
    }
  }
}

function inspectOwnedRoutes(owned, dir, findings, routed) {
  for (const file of owned) {
    if (!existsSync(join(dir, file))) findings.push(`MISSING Arbiter-owned hook ${file}`)
    else if (!routed.has(file)) findings.push(`DEAD Arbiter-owned hook ${file}`)
  }
}

function inspectCodexRoutes(owned, config, adapterPath) {
  const findings = []
  if (!existsSync(adapterPath)) findings.push('MISSING Codex adapter .codex/codex-adapter.mjs')
  for (const file of owned) {
    const path = `.claude/hooks/${file}`
    if (!config.includes(`.codex/codex-adapter.mjs ${path}`)) {
      findings.push(`DEAD Codex adapter hook ${file}`)
    }
  }
  return [...new Set(findings)].sort()
}
