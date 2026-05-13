import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'

export interface KnowledgeMapOptions {
  dir?: string
}

export function runKnowledgeMapUpdate(opts: KnowledgeMapOptions = {}): void {
  const dir = resolve(opts.dir ?? '.')
  const scriptPath = join(dir, 'scripts', 'knowledge-map-update.mjs')

  if (!existsSync(scriptPath)) {
    process.stdout.write('  knowledge-map: no knowledge-map-update.mjs script found\n')
    return
  }

  try {
    const result = runCli('node', [scriptPath], { cwd: dir })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  } catch (err) {
    if (err instanceof CliError) {
      if (err.stdout) process.stdout.write(err.stdout)
      if (err.stderr) process.stderr.write(err.stderr)
    }
    throw err
  }
}
