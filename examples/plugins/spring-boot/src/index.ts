import type { ArbiterPlugin, PluginContext, PluginResult } from '@arbiter/cli/plugin'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const plugin: ArbiterPlugin = {
  name: 'arbiter-plugin-spring-boot',
  apiVersion: '1',
  templateRoot: join(__dirname, '..', 'templates'),

  detect(config) {
    return config.tools !== undefined && config.tools.length > 0
  },

  generate(_ctx: PluginContext): PluginResult {
    return { files: [] }
  },
}

export default plugin
