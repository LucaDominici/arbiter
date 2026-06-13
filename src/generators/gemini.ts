// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

// EXPERIMENTAL, not customer-facing: the Gemini CLI scaffold remains for internal
// use only — unit-tested, never advertised, never checked against the real CLI.
// Read ../wizard/types.ts (AiTool) before re-exposing it.
export const generateGemini = makeAgentFileGenerator({
  outPath: ['.gemini', 'GEMINI.md'],
  templatePath: 'gemini/GEMINI.md.ejs',
})
