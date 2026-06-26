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

function sumUsage(usage: MessageUsage): { input: number; output: number } {
  return {
    input:
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0),
    output: usage.output_tokens ?? 0,
  }
}

export function readTranscriptCosts(transcriptPath: string, sinceISO: string): TranscriptCosts {
  try {
    const raw = readFileSync(transcriptPath, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)

    let input = 0
    let output = 0
    let samples = 0
    const sinceMs = Date.parse(sinceISO)

    for (const line of lines) {
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }

      // A bare scalar (notably `null` — valid JSON) is not a transcript record:
      // skip it rather than letting a property read throw and abandon the file.
      if (typeof record !== 'object' || record === null) continue
      const parsed = record as TranscriptLine

      if (parsed.type !== 'assistant') continue
      // Compare instants numerically — a lexicographic string compare is wrong for
      // offset forms (`+02:00`) or differing fractional-second widths.
      const tsMs = Date.parse(parsed.timestamp ?? '')
      if (Number.isNaN(tsMs) || tsMs < sinceMs) continue

      const usage = parsed.message?.usage
      if (!usage) continue

      const tokens = sumUsage(usage)
      input += tokens.input
      output += tokens.output
      samples++
    }

    return { input, output, samples }
  } catch {
    return { input: 0, output: 0, samples: 0 }
  }
}
