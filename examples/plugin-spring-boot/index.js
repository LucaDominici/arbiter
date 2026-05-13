'use strict'

const { join } = require('node:path')

/** @type {import("@arbiter/cli/plugin").ArbiterPlugin} */
module.exports = {
  name: 'arbiter-plugin-spring-boot',
  apiVersion: '1',
  templateRoot: join(__dirname, 'templates'),

  detect(config) {
    return config.archetype === 'backend-web-db'
  },

  generate(ctx) {
    const rendered = ctx.renderTemplate('Application.java.ejs', {
      projectName: ctx.config.tools?.join(', ') ?? 'project',
    })
    return {
      files: [
        {
          path: join(ctx.targetDir, 'src', 'main', 'java', 'com', 'example', 'Application.java'),
          content: rendered,
          action: 'create',
        },
      ],
    }
  },
}
