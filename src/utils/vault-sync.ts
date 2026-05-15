// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { WriteResult } from './fs.js'

const MARKER_RE = /<!--\s*arbiter:generated[^>]*-->/

export function writeVaultFile(
  filePath: string,
  content: string,
  opts: { force?: boolean } = {},
): WriteResult {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
    return { path: filePath, action: 'created' }
  }

  const existing = readFileSync(filePath, 'utf-8')
  if (!opts.force && !MARKER_RE.test(existing)) {
    return { path: filePath, action: 'skipped' }
  }

  // Parent directory already exists because we just read the file (#277 #16).
  writeFileSync(filePath, content, 'utf-8')
  return { path: filePath, action: 'backed-up-and-replaced' }
}
