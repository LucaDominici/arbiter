// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

const MAX_TEST_SCAN_DEPTH = 4
const MAX_TEST_SCAN_ENTRIES = 500
const EXCLUDED_TEST_SCAN_DIRECTORIES = new Set([
  '.git',
  'build',
  'dist',
  'node_modules',
  'target',
  'vendor',
])

export interface ExistingState {
  agentsMd: boolean
  claudeDir: boolean
  agentsDir: boolean
  aiRulez: boolean
  settingsJson: boolean
  checkAllScript: boolean
  geminiDir: boolean
  windsurfRules: boolean
  aiderConf: boolean
  tests: boolean
  ciWorkflows: boolean
  lintConfig: boolean
}

export function detectExisting(dir: string): ExistingState {
  return {
    agentsMd: existsSync(join(dir, 'AGENTS.md')),
    claudeDir: existsSync(join(dir, '.claude')),
    agentsDir: existsSync(join(dir, '.agents')),
    aiRulez: existsSync(join(dir, '.ai-rulez')) || existsSync(join(dir, 'ai-rulez.yml')),
    settingsJson: existsSync(join(dir, '.claude', 'settings.json')),
    checkAllScript:
      existsSync(join(dir, 'scripts', 'check-all.mjs')) ||
      existsSync(join(dir, 'scripts', 'check-all.sh')),
    geminiDir: existsSync(join(dir, '.gemini')),
    windsurfRules: existsSync(join(dir, 'windsurf-instructions.md')),
    aiderConf: existsSync(join(dir, '.aider.conf.yml')),
    tests: detectTests(dir),
    ciWorkflows: detectCiWorkflows(dir),
    lintConfig: detectLintConfig(dir),
  }
}

export function isBrownfield(state: ExistingState): boolean {
  return state.tests || state.ciWorkflows || state.lintConfig
}

function detectTests(dir: string): boolean {
  let scannedEntries = 0
  const pending = [{ path: dir, depth: 0 }]

  while (pending.length > 0 && scannedEntries < MAX_TEST_SCAN_ENTRIES) {
    const current = pending.pop()
    if (current === undefined) break

    let entries: Dirent[]
    try {
      entries = readdirSync(current.path, { withFileTypes: true })
    } catch (err) {
      // FAIL-OPEN-INTENT: an absent target directory is valid during config
      // projection and proves no test evidence; all inspection errors surface.
      if (isMissingPath(err)) continue
      throw new Error(`Cannot scan ${current.path} for tests`, { cause: err })
    }

    for (const entry of entries) {
      scannedEntries += 1
      if (scannedEntries > MAX_TEST_SCAN_ENTRIES) return false

      if (entry.isDirectory()) {
        if (isTestDirectory(entry.name)) return true
        if (
          current.depth < MAX_TEST_SCAN_DEPTH &&
          !EXCLUDED_TEST_SCAN_DIRECTORIES.has(entry.name)
        ) {
          pending.push({ path: join(current.path, entry.name), depth: current.depth + 1 })
        }
        continue
      }

      if (entry.isFile() && isTestFile(entry.name)) return true
    }
  }

  return false
}

function isTestDirectory(name: string): boolean {
  return name === 'test' || name === 'tests' || name === '__tests__' || name === 'spec'
}

function isTestFile(name: string): boolean {
  return (
    name.endsWith('_test.go') ||
    /^test_.*\.py$/.test(name) ||
    /_test\.py$/.test(name) ||
    /\.test\.(?:ts|tsx|js|jsx)$/.test(name) ||
    /\.spec\.[^.]+$/.test(name)
  )
}

function detectCiWorkflows(dir: string): boolean {
  const workflowsDir = join(dir, '.github', 'workflows')
  if (!existsSync(workflowsDir)) return false

  try {
    return readdirSync(workflowsDir, { withFileTypes: true }).some(
      (entry) => entry.isFile() && /\.ya?ml$/.test(entry.name),
    )
  } catch (err) {
    throw new Error(`Cannot inspect CI workflows in ${workflowsDir}`, { cause: err })
  }
}

function detectLintConfig(dir: string): boolean {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    // FAIL-OPEN-INTENT: an absent target directory is valid during config
    // projection and proves no lint-configuration evidence; other errors surface.
    if (isMissingPath(err)) return false
    throw new Error(`Cannot inspect lint configuration in ${dir}`, { cause: err })
  }

  const names = new Set(entries.map((entry) => entry.name))
  if (
    [...names].some((name) => name.startsWith('.eslintrc') || name.startsWith('eslint.config.')) ||
    [
      '.golangci.yml',
      '.golangci.yaml',
      'ruff.toml',
      '.ruff.toml',
      'setup.cfg',
      '.flake8',
      'tox.ini',
      '.rubocop.yml',
      'clippy.toml',
      'checkstyle.xml',
    ].some((name) => names.has(name))
  ) {
    return true
  }

  if (!names.has('pyproject.toml')) return false
  try {
    return /^\s*\[tool\.(ruff|black)\]\s*$/m.test(readFileSync(join(dir, 'pyproject.toml'), 'utf8'))
  } catch (err) {
    throw new Error(`Cannot read pyproject.toml in ${dir}`, { cause: err })
  }
}

function isMissingPath(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  )
}
