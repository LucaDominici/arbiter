// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

export const generateGemini = makeAgentFileGenerator({
  outPath: ['.gemini', 'GEMINI.md'],
  templatePath: 'gemini/GEMINI.md.ejs',
})
