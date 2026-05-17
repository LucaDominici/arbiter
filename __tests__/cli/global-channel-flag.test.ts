// SPDX-License-Identifier: Apache-2.0
/**
 * Collision guard: verify no subcommand registers its own --channel flag.
 * If a subcommand declares --channel, Commander would shadow the global flag
 * and break channel resolution. (#662)
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const commandsDir = join(__dirname, '../../src/commands')

describe('--channel global flag — no subcommand collision (#662)', () => {
  it('no src/commands/*.ts file registers .option("--channel") or .option("-c, --channel")', () => {
    const files = readdirSync(commandsDir).filter((f) => f.endsWith('.ts'))
    const collisions: string[] = []

    for (const file of files) {
      const content = readFileSync(join(commandsDir, file), 'utf-8')
      // Match .option( calls that include '--channel' (with or without short alias)
      if (/\.option\([^)]*'--channel[^)]*'\)/.test(content)) {
        collisions.push(file)
      }
    }

    expect(collisions).toEqual([])
  })
})
