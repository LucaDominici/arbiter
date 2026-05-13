#!/usr/bin/env node
// update-bloat-baseline.mjs — advance .bloat-baseline.json to current state
// Usage: node scripts/update-bloat-baseline.mjs --task=#NNN
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { countFiles, countFilesShallow, countLOC } from './bloat-lib.mjs'

const taskArg = process.argv.find((a) => a.startsWith('--task='))
if (!taskArg) {
  process.stderr.write('Usage: node scripts/update-bloat-baseline.mjs --task=#NNN\n')
  process.exit(1)
}

const cwd = process.cwd()
const BASELINE_FILE = resolve(cwd, '.bloat-baseline.json')
const EXTS = ['.ts', '.mjs', '.js']

const buckets = {
  srcDirect: {
    files: countFilesShallow(resolve(cwd, 'src'), EXTS),
    loc: countLOC(resolve(cwd, 'src'), EXTS, false),
  },
  generators: {
    files: countFiles(resolve(cwd, 'src/generators'), EXTS),
    loc: countLOC(resolve(cwd, 'src/generators'), EXTS),
  },
  commands: {
    files: countFiles(resolve(cwd, 'src/commands'), EXTS),
    loc: countLOC(resolve(cwd, 'src/commands'), EXTS),
  },
  templates: {
    files: countFiles(resolve(cwd, 'src/templates'), ['.ejs', '.ts', '.mjs', '.js']),
    loc: countLOC(resolve(cwd, 'src/templates'), ['.ejs', '.ts', '.mjs', '.js']),
  },
}

writeFileSync(
  BASELINE_FILE,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      task: taskArg.replace('--task=', ''),
      buckets,
    },
    null,
    2,
  ) + '\n',
  'utf-8',
)

process.stdout.write(`[bloat] baseline updated → ${BASELINE_FILE}\n`)
console.log(JSON.stringify(buckets, null, 2))
