// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

export const generateCursor = makeAgentFileGenerator({
  outPath: ['.cursorrules'],
  templatePath: 'cursor/.cursorrules.ejs',
})
