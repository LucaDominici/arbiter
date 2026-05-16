'use strict'

module.exports = {
  name: 'hanging-plugin',
  apiVersion: '1',
  templateRoot: __dirname,
  generate(_ctx) {
    return new Promise(() => {
      setInterval(() => {}, 100)
    })
  },
}
