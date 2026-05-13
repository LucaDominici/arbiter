import { resolve } from 'node:path'
import { loadConfig, saveConfig } from '../utils/config.js'
import { validateConfig } from '../config/schema.js'
import { jsonOutput } from '../utils/json-output.js'
import type { ArbiterConfigV2 } from '../config/schema.js'

export interface ConfigureOptions {
  dir?: string | undefined
  sets: string[]
  json?: boolean | undefined
}

const ALLOWED_PATHS = new Set([
  'features.contractTesting',
  'features.mutationTesting',
  'features.securityScanning',
  'features.evidenceHarness',
  'features.debtGates',
  'features.suppressions',
  'features.soloDevMode',
  'thresholds.lineCoverage',
  'thresholds.branchCoverage',
  'thresholds.mutationScore',
  'thresholds.cyclomaticComplexity',
  'thresholds.methodLength',
  'thresholds.maxParams',
  'governanceLevel',
  'useGitHub',
  'tools',
  'archetype',
  'architectureStyle',
  'isMultiTenant',
  'hasDatabase',
  'hasPublicApi',
  'contractType',
])

const VALID_TOOLS = new Set(['claude', 'codex', 'cursor', 'copilot', 'gemini', 'windsurf', 'aider'])

const VALID_ARCHETYPES = new Set([
  'backend-web-db',
  'cli',
  'library',
  'data-pipeline',
  'frontend-spa',
  'embedded',
])

const VALID_ARCHITECTURE_STYLES = new Set(['hexagonal', 'layered', 'modular-monolith', 'none'])

const VALID_CONTRACT_TYPES = new Set([
  'rest-owned',
  'rest-public',
  'graphql',
  'grpc',
  'message-queue',
  'none',
])

function parseAxisValue(path: string, raw: string): unknown {
  if (path === 'archetype') {
    if (!VALID_ARCHETYPES.has(raw))
      throw new Error(`Invalid archetype: "${raw}". Valid: ${[...VALID_ARCHETYPES].join(', ')}`)
    return raw
  }
  if (path === 'architectureStyle') {
    if (!VALID_ARCHITECTURE_STYLES.has(raw))
      throw new Error(
        `Invalid architectureStyle: "${raw}". Valid: ${[...VALID_ARCHITECTURE_STYLES].join(', ')}`,
      )
    return raw
  }
  if (path === 'contractType') {
    if (!VALID_CONTRACT_TYPES.has(raw))
      throw new Error(
        `Invalid contractType: "${raw}". Valid: ${[...VALID_CONTRACT_TYPES].join(', ')}`,
      )
    return raw
  }
  // isMultiTenant, hasDatabase, hasPublicApi
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${path} must be true or false — got: ${raw}`)
}

const AXIS_PATHS = new Set([
  'archetype',
  'architectureStyle',
  'isMultiTenant',
  'hasDatabase',
  'hasPublicApi',
  'contractType',
])

function parseValue(path: string, raw: string): unknown {
  if (path.startsWith('features.')) {
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error(`features.* must be true or false — got: ${raw}`)
  }
  if (path.startsWith('thresholds.')) {
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new Error(`${path} must be a number — got: ${raw}`)
    return n
  }
  if (path === 'useGitHub') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error(`useGitHub must be true or false — got: ${raw}`)
  }
  if (path === 'tools') {
    const toolList = raw.split(',').map((t) => t.trim())
    for (const t of toolList) {
      if (!VALID_TOOLS.has(t)) {
        throw new Error(`Invalid tool: "${t}". Valid tools: ${[...VALID_TOOLS].join(', ')}`)
      }
    }
    return toolList
  }
  if (AXIS_PATHS.has(path)) return parseAxisValue(path, raw)
  return raw
}

function applySet(config: ArbiterConfigV2, path: string, value: unknown): ArbiterConfigV2 {
  const parts = path.split('.')
  if (parts.length === 1 && parts[0] !== undefined) {
    const key0 = parts[0]
    return { ...config, [key0]: value }
  }
  if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
    const top = parts[0]
    const key = parts[1]
    const root = config as unknown as Record<string, Record<string, unknown>>
    const parent = root[top] ?? {}
    return {
      ...config,
      [top]: { ...parent, [key]: value },
    }
  }
  throw new Error(`Unsupported path depth: ${path}`)
}

export function runConfigure(options: ConfigureOptions): void {
  if (options.sets.length === 0) {
    if (options.json) {
      jsonOutput('configure', 'error', {}, ['--set is required (non-interactive usage)'])
      process.exit(1)
      return
    }
    console.error(
      '  Usage: arbiter configure --set <path>=<value>\n' +
        '  Interactive mode requires a TTY. Non-interactive usage requires --set.\n',
    )
    process.exit(2)
  }

  const targetDir = resolve(options.dir ?? process.cwd())
  const stored = loadConfig(targetDir)
  if (!stored) {
    if (options.json) {
      jsonOutput('configure', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'])
      process.exit(1)
      return
    }
    throw new Error('No arbiter.json found. Run `arbiter init` first.')
  }

  let config = stored

  for (const assignment of options.sets) {
    const eqIdx = assignment.indexOf('=')
    if (eqIdx < 0) {
      throw new Error(`Invalid --set format (expected path=value): ${assignment}`)
    }
    const path = assignment.slice(0, eqIdx)
    const rawValue = assignment.slice(eqIdx + 1)

    if (!ALLOWED_PATHS.has(path)) {
      throw new Error(`Unknown configuration path: ${path}`)
    }

    const value = parseValue(path, rawValue)
    config = applySet(config, path, value)
  }

  const result = validateConfig(config)
  if (!result.ok) {
    throw new Error(`Configuration invalid after changes:\n  ${result.errors.join('\n  ')}`)
  }

  saveConfig(targetDir, result.config)

  if (options.json) {
    jsonOutput('configure', 'ok', { updated: options.sets })
    return
  }
  console.log(`  Updated: ${options.sets.join(', ')}`)
}
