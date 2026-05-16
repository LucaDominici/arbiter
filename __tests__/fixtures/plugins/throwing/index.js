'use strict'

module.exports = {
  name: 'throwing-plugin',
  apiVersion: '1',
  templateRoot: __dirname,
  generate(_ctx) {
    throw new Error('plugin generate failed intentionally')
  },
}
