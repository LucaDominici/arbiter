// SPDX-License-Identifier: Apache-2.0
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface HostCapabilities {
  modelSwitch: boolean
  transcriptPath: string | null
  exitPlanModeTool: boolean
}

function isTruthy(val: string | undefined): boolean {
  return !!val && val !== '0' && val !== 'false'
}

function findTranscriptPath(): string | null {
  try {
    const cwd = process.cwd()
    const encoded = encodeURIComponent(cwd).replace(/%2F/g, '-').replace(/^-/, '')
    const projectsDir = join(homedir(), '.claude', 'projects')
    const entries = readdirSync(projectsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.includes(encoded.slice(0, 20))) continue
      const dir = join(projectsDir, entry.name)
      const files = readdirSync(dir)
      const jsonl = files.find((f) => f.endsWith('.jsonl'))
      if (jsonl) return join(dir, jsonl)
    }
    return null
  } catch {
    return null
  }
}

export function detectHostCapabilities(): HostCapabilities {
  try {
    const modelSwitch = isTruthy(process.env['CLAUDECODE'])
    return {
      modelSwitch,
      transcriptPath: findTranscriptPath(),
      exitPlanModeTool: modelSwitch,
    }
  } catch (err: unknown) {
    process.stderr.write(
      `[arbiter] warn: detectHostCapabilities threw unexpectedly: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return { modelSwitch: false, transcriptPath: null, exitPlanModeTool: false }
  }
}
