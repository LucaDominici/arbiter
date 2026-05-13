import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'

const GATES = [
  'check-ssot-core',
  'check-doc-links',
  'check-knowledge-map',
  'check-canonical-paths',
] as const

export interface HarnessGateResult {
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

export function runHarness(opts: HarnessOptions = {}): HarnessResult {
  const dir = resolve(opts.dir ?? '.')
  const fast = opts.fast ?? false
  const gates: HarnessGateResult[] = []
  let failed = 0
  let skipped = 0

  for (const gateName of GATES) {
    const scriptPath = join(dir, 'scripts', `${gateName}.mjs`)

    if (!existsSync(scriptPath)) {
      process.stdout.write(`  harness: ${gateName} — skip (script not found)\n`)
      gates.push({ name: gateName, status: 'skip', stdout: '', stderr: '' })
      skipped++
      continue
    }

    process.stdout.write(`  harness: ${gateName} ... `)
    try {
      const result = runCli('node', [scriptPath], { cwd: dir })
      process.stdout.write(`pass\n`)
      if (result.stdout) process.stdout.write(result.stdout)
      gates.push({
        name: gateName,
        status: 'pass',
        stdout: result.stdout,
        stderr: result.stderr,
      })
    } catch (err) {
      process.stdout.write(`FAIL\n`)
      if (err instanceof CliError) {
        if (err.stdout) process.stdout.write(err.stdout)
        if (err.stderr) process.stderr.write(err.stderr)
        gates.push({
          name: gateName,
          status: 'fail',
          stdout: err.stdout,
          stderr: err.stderr,
        })
      } else {
        process.stderr.write(String(err) + '\n')
        gates.push({
          name: gateName,
          status: 'fail',
          stdout: '',
          stderr: String(err),
        })
      }
      failed++
      if (fast) break
    }
  }

  const exitCode: 0 | 1 = failed > 0 ? 1 : 0
  return {
    passed: gates.filter((g) => g.status === 'pass').length,
    failed,
    skipped,
    exitCode,
    gates,
  }
}
