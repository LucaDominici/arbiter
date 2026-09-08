#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Compact emitted distribution files without changing its public surface.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const KIT_JSON = [
  'dist/kit/catalog.json',
  'dist/kit/derived.json',
  'dist/kit/canonical-mapping.json',
]

function fail(message) {
  throw new Error(`build-dist: ${message}`)
}

function regularJsFiles(directory) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    fail(`cannot read ${relative(ROOT, directory)}: ${error.message}`)
  }

  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'templates') files.push(...regularJsFiles(path))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path)
    }
  }
  return files
}

function leadingHeaders(source) {
  let body = source
  let hashbang = ''
  let spdx = ''

  if (body.startsWith('#!')) {
    const end = body.search(/\r?\n|\r/)
    if (end < 0) return { hashbang: body, spdx, body: '' }
    const newlineEnd = body[end] === '\r' && body[end + 1] === '\n' ? end + 2 : end + 1
    hashbang = body.slice(0, newlineEnd)
    body = body.slice(newlineEnd)
  }

  const match = body.match(/^\/\/ SPDX-License-Identifier: Apache-2\.0(?:\r\n|\n|\r)?/)
  if (match) {
    spdx = match[0]
    body = body.slice(spdx.length)
  }
  return { hashbang, spdx, body }
}

if (!statSync(DIST, { throwIfNoEntry: false })?.isDirectory()) fail('dist/ is missing')

const jsFiles = regularJsFiles(DIST)
if (jsFiles.length === 0) fail('no emitted .js files found')

for (const path of jsFiles) {
  const source = readFileSync(path, 'utf8')
  const { hashbang, spdx, body } = leadingHeaders(source)
  const result = await transform(body, {
    loader: 'js',
    minifyWhitespace: true,
    minifyIdentifiers: false,
    minifySyntax: false,
    legalComments: 'inline',
    sourcefile: relative(ROOT, path),
  })
  writeFileSync(path, hashbang + spdx + result.code)
}

for (const rel of KIT_JSON) {
  const path = join(ROOT, rel)
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) fail(`${rel} is missing`)
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`cannot parse ${rel}: ${error.message}`)
  }
  writeFileSync(path, JSON.stringify(value) + '\n')
}

process.stderr.write(
  `build-dist: compacted ${jsFiles.length} emitted JS files and ${KIT_JSON.length} kit JSON files\n`,
)
