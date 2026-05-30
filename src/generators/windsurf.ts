// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

export const generateWindsurf = makeAgentFileGenerator({
  outPath: ['windsurf-instructions.md'],
  templatePath: 'windsurf/windsurf-instructions.md.ejs',
})
