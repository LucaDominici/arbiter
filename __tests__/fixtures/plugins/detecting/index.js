'use strict'

module.exports = {
  name: 'detecting-plugin',
  apiVersion: '1',
  templateRoot: __dirname,
  detect(_config) {
    return true
  },
  generate(_ctx) {
    return { files: [] }
  },
}
