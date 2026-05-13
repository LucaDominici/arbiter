'use strict'

module.exports = {
  name: 'mock-arbiter-plugin',
  apiVersion: '1',
  templateRoot: __dirname + '/templates',
  generate(ctx) {
    return {
      files: [
        {
          path: ctx.targetDir + '/mock-output.txt',
          content: 'mock output from ' + ctx.config.projectName,
          action: 'create',
        },
      ],
    }
  },
}
