#!/usr/bin/env node
// CATALOG: validates the complete emitted-hook → dispatcher → settings route.
// It cannot fold into emission coherence because this script is emitted into governed targets.
// The target-side runtime inventory catches brownfield and user-preservation drift after update.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const hooksDir = join(root, '.claude', 'hooks')
const dispatcherPath = join(hooksDir, 'hooks.mjs')
const settingsPath = join(root, '.claude', 'settings.json')

try {
  const owned = readOwnedHooks(root, hooksDir)
  const handlers = parseHandlers(readRequired(dispatcherPath))
  const wired = parseWiredEvents(readRequired(settingsPath))
  const findings = inspectRoutes(owned, handlers, wired, hooksDir)
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
  const generatedPath = join(repoRoot, '.arbiter-generated-manifest.json')
  if (existsSync(generatedPath)) {
    const parsed = JSON.parse(readFileSync(generatedPath, 'utf-8'))
    if (parsed?.$schemaVersion !== 1 || typeof parsed.files !== 'object' || parsed.files === null) {
      throw new Error('.arbiter-generated-manifest.json has an invalid shape')
    }
    return new Set(
      Object.keys(parsed.files)
        .filter((path) => /^\.claude\/hooks\/[^/]+\.mjs$/.test(path))
        .map((path) => path.slice('.claude/hooks/'.length))
        .filter((file) => file !== 'hooks.mjs' && file !== 'lib.mjs'),
    )
  }

  const hardnessPath = join(repoRoot, '.arbiter', 'hooks-manifest.json')
  if (existsSync(hardnessPath)) {
    const parsed = JSON.parse(readFileSync(hardnessPath, 'utf-8'))
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

  return new Set(
    readdirSync(dir)
      .filter((file) => file.endsWith('.mjs') && file !== 'hooks.mjs' && file !== 'lib.mjs')
      .filter((file) => readFileSync(join(dir, file), 'utf-8').includes('Arbiter hook:')),
  )
}

function parseHandlers(source) {
  const block = /const HANDLERS\s*=\s*\{([\s\S]*?)\n\};/.exec(source)
  if (!block) throw new Error('hooks.mjs has no parseable HANDLERS table')
  const handlers = new Map()
  const eventPattern = /'([^']+)'\s*:\s*\[([\s\S]*?)\],/g
  for (const match of block[1].matchAll(eventPattern)) {
    const files = [...match[2].matchAll(/'([^']+\.mjs)'/g)].map((item) => item[1])
    handlers.set(match[1], files)
  }
  if (handlers.size === 0) throw new Error('hooks.mjs HANDLERS table is empty or malformed')
  return handlers
}

function parseWiredEvents(source) {
  const settings = JSON.parse(source)
  if (typeof settings?.hooks !== 'object' || settings.hooks === null) {
    throw new Error('settings.json has no hooks object')
  }
  const wired = new Set()
  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) throw new Error(`settings hook event ${event} is not an array`)
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null || !Array.isArray(entry.hooks)) continue
      const expected = typeof entry.matcher === 'string' ? `${event}:${entry.matcher}` : event
      for (const hook of entry.hooks) {
        const command = typeof hook?.command === 'string' ? hook.command : ''
        const match = /hooks\.mjs["']?\s+["']?([^"' ]+)["']?/.exec(command)
        if (match?.[1] === expected) wired.add(expected)
      }
    }
  }
  return wired
}

function inspectRoutes(owned, handlers, wired, dir) {
  const findings = []
  const routed = new Set()
  for (const [event, files] of handlers) {
    if (files.length > 0 && !wired.has(event)) findings.push(`UNROUTED event ${event}`)
    for (const file of files) {
      routed.add(file)
      if (!existsSync(join(dir, file))) findings.push(`MISSING handler ${file} for ${event}`)
    }
  }
  for (const file of owned) {
    if (!existsSync(join(dir, file))) findings.push(`MISSING Arbiter-owned hook ${file}`)
    else if (!routed.has(file)) findings.push(`DEAD Arbiter-owned hook ${file}`)
  }
  return [...new Set(findings)].sort()
}
