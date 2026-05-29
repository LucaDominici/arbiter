// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

export const generateCopilot = makeAgentFileGenerator({
  outPath: ['.github', 'copilot-instructions.md'],
  templatePath: 'copilot/copilot-instructions.md.ejs',
})
