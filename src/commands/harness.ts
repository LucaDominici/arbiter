// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'

const GATES = [
  'check-ssot-core',
  'check-doc-links',
  'check-knowledge-map',
  'check-canonical-paths',
] as const

interface HarnessGateResult {
  name: string
  status: 'pass' | 'fail' | 'skip'
  stdout: string
  stderr: string
}

export interface HarnessResult {
  passed: number
  failed: number
  skipped: number
  exitCode: 0 | 1
  gates: HarnessGateResult[]
}

export interface HarnessOptions {
  dir?: string
  fast?: boolean
}

/** Run one SSOT gate script (or report it skipped when absent). */
function runOneGate(dir: string, gateName: string): HarnessGateResult {
  const scriptPath = join(dir, 'scripts', `${gateName}.mjs`)

  if (!existsSync(scriptPath)) {
    process.stdout.write(`  harness: ${gateName} — skip (script not found)\n`)
    return { name: gateName, status: 'skip', stdout: '', stderr: '' }
  }

  process.stdout.write(`  harness: ${gateName} ... `)
  try {
    const result = runCli('node', [scriptPath], { cwd: dir })
    process.stdout.write(`pass\n`)
    if (result.stdout) process.stdout.write(result.stdout)
    return { name: gateName, status: 'pass', stdout: result.stdout, stderr: result.stderr }
  } catch (err) {
    process.stdout.write(`FAIL\n`)
    if (err instanceof CliError) {
      if (err.stdout) process.stdout.write(err.stdout)
      if (err.stderr) process.stderr.write(err.stderr)
      return { name: gateName, status: 'fail', stdout: err.stdout, stderr: err.stderr }
    }
    process.stderr.write(String(err) + '\n')
    return { name: gateName, status: 'fail', stdout: '', stderr: String(err) }
  }
}

export function runHarness(opts: HarnessOptions = {}): HarnessResult {
  const dir = resolve(opts.dir ?? '.')
  const fast = opts.fast ?? false
  const gates: HarnessGateResult[] = []

  for (const gateName of GATES) {
    const gate = runOneGate(dir, gateName)
    gates.push(gate)
    if (gate.status === 'fail' && fast) break
  }

  const passed = gates.filter((g) => g.status === 'pass').length
  const failed = gates.filter((g) => g.status === 'fail').length
  const skipped = gates.filter((g) => g.status === 'skip').length

  // Vacuous-green floor (#1652): a run where every gate was skipped (no script
  // on disk) verified nothing — it must not report a passing exit. This upholds
  // the anti-fake-green contract for partial checkouts or trees missing scripts/.
  const ranNone = gates.length > 0 && gates.every((g) => g.status === 'skip')
  if (ranNone) {
    process.stdout.write('  harness: no SSOT gate scripts found — nothing was verified\n')
  }
  const exitCode: 0 | 1 = failed > 0 || ranNone ? 1 : 0
  return { passed, failed, skipped, exitCode, gates }
}
