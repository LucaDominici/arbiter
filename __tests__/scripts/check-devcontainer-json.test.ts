// SPDX-License-Identifier: Apache-2.0
// TDD red-phase test for #541: .devcontainer/devcontainer.json shape
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const devcontainer = resolve(repoRoot, '.devcontainer/devcontainer.json')

describe('.devcontainer/devcontainer.json', () => {
  it('exists', () => {
    expect(existsSync(devcontainer)).toBe(true)
  })

  it('is valid JSON with required fields', () => {
    const raw = readFileSync(devcontainer, 'utf-8')
    const json = JSON.parse(raw)
    expect(typeof json.name).toBe('string')
    expect(typeof json.image).toBe('string')
    expect(json.image).toContain('node')
  })

  it('has postCreateCommand', () => {
    const json = JSON.parse(readFileSync(devcontainer, 'utf-8'))
    expect(typeof json.postCreateCommand).toBe('string')
  })
})
