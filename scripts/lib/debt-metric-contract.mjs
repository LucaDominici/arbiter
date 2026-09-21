// SPDX-License-Identifier: Apache-2.0
// Commands whose output defines a debt metric. Execution and inspection import this same value.
export const DEBT_METRIC_COMMANDS = Object.freeze({
  complexityViolations: Object.freeze([
    'npx',
    'eslint',
    'src',
    'scripts',
    '--format',
    'json',
    '--rule',
    '{"complexity":["warn",10]}',
  ]),
})
