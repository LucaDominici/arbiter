// SPDX-License-Identifier: Apache-2.0

export interface LexiconEntry {
  token: string
  allowContext?: string
}

export interface RedactionMatch {
  token: string
  line: number
  lineContent: string
}

export function scanForRedactedTokens(text: string, lexicon: LexiconEntry[]): RedactionMatch[] {
  const matches: RedactionMatch[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i] ?? ''
    for (const entry of lexicon) {
      if (!lineContent.includes(entry.token)) continue
      if (entry.allowContext !== undefined && lineContent.includes(entry.allowContext)) continue
      matches.push({ token: entry.token, line: i + 1, lineContent })
    }
  }
  return matches
}
