// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

// EXPERIMENTAL, not customer-facing: Cursor support is retained and unit-tested
// but unadvertised (not selectable via `init --tools`, hidden from the wizard)
// and not validated against the live editor. See AiTool policy in ../wizard/types.ts.
export const generateCursor = makeAgentFileGenerator({
  outPath: ['.cursorrules'],
  templatePath: 'cursor/.cursorrules.ejs',
})
