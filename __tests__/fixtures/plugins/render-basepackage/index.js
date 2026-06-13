'use strict'

// #1348: exercises the worker's renderTemplate with a template that references
// a bare `basePackage` and a render-data object that has NO `basePackage` key.
// Pre-fix this threw `basePackage is not defined` inside the worker thread.
module.exports = {
  name: 'render-basepackage-plugin',
  apiVersion: '1',
  templateRoot: __dirname + '/templates',
  generate(ctx) {
    const rendered = ctx.renderTemplate('Sample.java.ejs', {
      projectName: ctx.config.projectName,
    })
    return {
      files: [
        {
          path: ctx.targetDir + '/Sample.java',
          content: rendered,
          action: 'create',
        },
      ],
    }
  },
}
