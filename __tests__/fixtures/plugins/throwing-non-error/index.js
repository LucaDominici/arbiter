'use strict'

// #1761: exercises the worker's non-Error catch branch (`String(err)` instead
// of `err.message`) — this plugin throws a bare string, not an Error.
module.exports = {
  name: 'throwing-non-error-plugin',
  apiVersion: '1',
  generate(_ctx) {
    throw 'string based failure'
  },
}
