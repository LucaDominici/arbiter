// SPDX-License-Identifier: Apache-2.0
import { makeAgentFileGenerator } from './agent-file.js'

export const generateAider = makeAgentFileGenerator({
  outPath: ['.aider.conf.yml'],
  templatePath: 'aider/.aider.conf.yml.ejs',
})
