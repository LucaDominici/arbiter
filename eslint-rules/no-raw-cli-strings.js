// SPDX-License-Identifier: Apache-2.0
// @ts-check

/** @type {import('eslint').Rule.RuleDefinition} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow raw string literals in CLI output calls — use t() instead',
      category: 'i18n',
      recommended: false,
    },
    schema: [],
    messages: {
      rawString:
        'Raw string literal in CLI output call. Use t("key") from src/i18n instead. (#656)',
    },
  },
  create(context) {
    const OUTPUT_METHODS = new Set(['log', 'error', 'warn', 'info'])
    const ERROR_CLASSES = new Set(['ArbiterError', 'UserFacingError'])

    function checkArg(node) {
      if (node.type === 'Literal' && typeof node.value === 'string') {
        context.report({ node, messageId: 'rawString' })
        return
      }
      // Flag template literals that contain non-empty static text parts.
      // Pure-expression templates like `${t('key')}` have only empty quasis and are allowed.
      if (node.type === 'TemplateLiteral') {
        const hasStaticText = node.quasis.some(
          (q) => q.value.cooked !== null && q.value.cooked !== '',
        )
        if (hasStaticText) {
          context.report({ node, messageId: 'rawString' })
        }
      }
    }

    function isConsoleOutput(node) {
      return (
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'console' &&
        node.callee.property.type === 'Identifier' &&
        OUTPUT_METHODS.has(node.callee.property.name)
      )
    }

    function isProcessWrite(node) {
      return (
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'MemberExpression' &&
        node.callee.object.object.type === 'Identifier' &&
        node.callee.object.object.name === 'process' &&
        node.callee.object.property.type === 'Identifier' &&
        (node.callee.object.property.name === 'stdout' ||
          node.callee.object.property.name === 'stderr') &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'write'
      )
    }

    return {
      CallExpression(node) {
        if (isConsoleOutput(node) || isProcessWrite(node)) {
          for (const arg of node.arguments) {
            checkArg(arg)
          }
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && ERROR_CLASSES.has(node.callee.name)) {
          // ArbiterError(code, message, opts) → message at index 1
          // UserFacingError(message) → message at index 0
          const argIndex = node.callee.name === 'UserFacingError' ? 0 : 1
          const messageArg = node.arguments[argIndex]
          if (messageArg) {
            checkArg(messageArg)
          }
        }
      },
    }
  },
}

export default rule
