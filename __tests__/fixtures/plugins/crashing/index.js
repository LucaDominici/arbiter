'use strict'

module.exports = {
  name: 'crashing-plugin',
  apiVersion: '1',
  templateRoot: __dirname,
  generate(_ctx) {
    process.exit(1)
  },
}
