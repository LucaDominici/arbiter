// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

// EXPERIMENTAL, not customer-facing: Windsurf output is preserved and covered by
// tests but excluded from the wizard, `init --tools`, docs and help; the live IDE
// is not part of any verification. AiTool support policy: ../wizard/types.ts.
export const generateWindsurf = makeAgentFileGenerator({
  outPath: ['windsurf-instructions.md'],
  templatePath: 'windsurf/windsurf-instructions.md.ejs',
})
