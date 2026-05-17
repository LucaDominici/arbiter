'use strict'

module.exports = {
  name: 'bad-detect-type-plugin',
  apiVersion: '1',
  templateRoot: __dirname,
  detect: 'not-a-function',
  generate() {
    return { files: [] }
  },
}
