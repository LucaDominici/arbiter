// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'

export interface TranscriptCosts {
  input: number
  output: number
  samples: number
}

interface MessageUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface TranscriptLine {
  type?: string
  timestamp?: string
  message?: { usage?: MessageUsage }
}

export function readTranscriptCosts(transcriptPath: string, sinceISO: string): TranscriptCosts {
  try {
    const raw = readFileSync(transcriptPath, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)

    let input = 0
    let output = 0
    let samples = 0

    for (const line of lines) {
      let parsed: TranscriptLine
      try {
        parsed = JSON.parse(line) as TranscriptLine
      } catch {
        return { input: 0, output: 0, samples: 0 }
      }

      if (parsed.type !== 'assistant') continue
      if (!parsed.timestamp || parsed.timestamp < sinceISO) continue

      const usage = parsed.message?.usage
      if (!usage) continue

      input +=
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      output += usage.output_tokens ?? 0
      samples++
    }

    return { input, output, samples }
  } catch {
    return { input: 0, output: 0, samples: 0 }
  }
}
