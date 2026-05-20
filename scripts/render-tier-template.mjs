#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// CATALOG: single-file EJS renderer for CI-tier templates. Cannot fold into
// scripts/check-tier-coverage.mjs (read-only verifier, no write surface) or
// into src/utils/render.ts (TypeScript; not directly invokable from .mjs without
// tsx wrapper which would add build-system asymmetry). Inline ejs.render keeps
// this script self-contained and matches the byte output of renderTemplate()
// because both delegate to the same ejs package.
//
// Usage:
//   node scripts/render-tier-template.mjs \
//       --template github/workflows/08-monthly.yml.ejs \
//       --out .github/workflows/08-monthly.yml \
//       [--context __tests__/fixtures/ci-tier-render-context.json]

import ejs from 'ejs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const TEMPLATES_DIR = join(REPO_ROOT, 'src', 'templates')
const DEFAULT_CONTEXT = join(REPO_ROOT, '__tests__', 'fixtures', 'ci-tier-render-context.json')

const { values } = parseArgs({
  options: {
    template: { type: 'string' },
    out: { type: 'string' },
    context: { type: 'string', default: DEFAULT_CONTEXT },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || !values.template || !values.out) {
  console.error(
    'Usage: render-tier-template.mjs --template <path-relative-to-src/templates> --out <output-path> [--context <fixture.json>]',
  )
  process.exit(values.help ? 0 : 2)
}

const templatePath = join(TEMPLATES_DIR, values.template)
const contextPath = resolve(values.context)
const outPath = resolve(values.out)

let source
try {
  source = readFileSync(templatePath, 'utf-8')
} catch (err) {
  console.error(`error: cannot read template ${templatePath}: ${err.message}`)
  process.exit(1)
}

let context
try {
  context = JSON.parse(readFileSync(contextPath, 'utf-8'))
} catch (err) {
  console.error(`error: cannot read context ${contextPath}: ${err.message}`)
  process.exit(1)
}

let rendered
try {
  rendered = ejs.render(source, context, { filename: templatePath })
} catch (err) {
  console.error(`error: ejs render failed for ${values.template}: ${err.message}`)
  process.exit(1)
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, rendered)
console.error(`wrote ${outPath} (${rendered.length} bytes)`)
