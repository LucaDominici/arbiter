// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

// EXPERIMENTAL, not customer-facing: Aider config generation is retained for
// internal/experimental use, fully unadvertised and unverified against the real
// terminal tool. The canonical support policy is in ../wizard/types.ts (AiTool).
export const generateAider = makeAgentFileGenerator({
  outPath: ['.aider.conf.yml'],
  templatePath: 'aider/.aider.conf.yml.ejs',
})
