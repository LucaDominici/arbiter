// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

// EXPERIMENTAL, not customer-facing: Copilot emission is kept and tested yet
// stays off every advertised surface, with no live-tool verification behind it.
// Support policy lives in ../wizard/types.ts (AiTool).
export const generateCopilot = makeAgentFileGenerator({
  outPath: ['.github', 'copilot-instructions.md'],
  templatePath: 'copilot/copilot-instructions.md.ejs',
})
