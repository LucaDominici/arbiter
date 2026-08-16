// SPDX-License-Identifier: Apache-2.0
// @ts-check
//
// CANON-17 (#1924): every direct fs.* failure handler in src/ must translate the raw
// NodeJS errno into an ArbiterError. "ENOENT" tells a user nothing about what is missing
// or how to fix it; translation routes the failure into the catalog where it gains a
// stable code, an actionable hint and an i18n key.
//
// Scope is deliberately narrow, which is why this does NOT produce the false-positive
// flood that blocked promotion for a year. It fires only when BOTH hold:
//   1. the guarded `try` calls a direct node:fs function, AND
//   2. the caught binding reaches the user RAW — either bare-rethrown (`throw err`, which
//      surfaces a NodeJS stack) or written straight to console / process.stdout / stderr.
// That is exactly the harm CANON-17 names: "Raw NodeJS stack traces or bare errno strings
// MUST NOT leak to user-facing stdout/stderr from CLI commands."
//
// What it deliberately does NOT flag, because none of it leaks a raw errno:
//   * `throw new Error(msg, { cause: err })` — the sanctioned Node idiom; identity is
//     preserved under a message the user can act on
//   * a structured domain result (`return { ok: false, reason: ... }`) — the caller decides
//     how to render it, and that render path is governed by i18n, not by this rule
//   * a logger call — structured, keyed, and not raw stdout
//   * an errno-aware handler that inspects `err.code` before deciding
// Measured on arbiter's own src/: 36 hits under the broad reading, 0 under this one.
//
// It resolves BINDINGS, not source names — `import { readFileSync as rf }`, `import * as
// fs`, `import fs`, and `node:fs/promises` all reach the same check, because each is a way
// to make the same call.

const FS_MODULES = new Set(['node:fs', 'node:fs/promises', 'fs', 'fs/promises'])

/** Calls that legitimately consume the caught error and produce a translated one. */
const TRANSLATORS = new Set(['toFsError'])
const ERROR_CLASSES = new Set(['ArbiterError', 'UserFacingError', 'FatalError'])

/** @type {import('eslint').Rule.RuleDefinition} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require direct node:fs failure handlers to translate errno into an ArbiterError (CANON-17)',
      category: 'errors',
      recommended: false,
    },
    schema: [],
    messages: {
      untranslatedErrno:
        'Direct node:fs failure handler lets a raw errno escape. Pass the caught error ' +
        'through toFsError(err, path) or build an ArbiterError from it — a bare ENOENT ' +
        'tells the user nothing. (CANON-17, #1924)',
    },
  },
  create(context) {
    /** Local bindings that name a direct fs function (named or aliased imports). */
    const fsFunctionBindings = new Set()
    /** Local bindings that are the whole fs module (default or namespace imports). */
    const fsModuleBindings = new Set()

    /** Does this node (or anything inside it) call a direct fs function? */
    function containsFsCall(node) {
      let found = false
      const seen = new Set()
      const visit = (n) => {
        if (found || n === null || typeof n !== 'object' || seen.has(n)) return
        seen.add(n)
        if (n.type === 'CallExpression') {
          const callee = n.callee
          if (callee.type === 'Identifier' && fsFunctionBindings.has(callee.name)) found = true
          else if (
            callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            fsModuleBindings.has(callee.object.name)
          )
            found = true
        }
        for (const key of Object.keys(n)) {
          if (key === 'parent') continue
          const child = n[key]
          if (Array.isArray(child)) child.forEach((c) => visit(c))
          else if (child && typeof child === 'object' && typeof child.type === 'string')
            visit(child)
        }
      }
      visit(node)
      return found
    }

    /** Is the caught binding passed into a translator or an ArbiterError constructor? */
    function bindingIsTranslated(handler, bindingName) {
      let translated = false
      const seen = new Set()
      /** Does this subtree reference the caught binding at all? */
      const references = (n) => {
        let hit = false
        const walk = (x) => {
          if (hit || x === null || typeof x !== 'object') return
          if (x.type === 'Identifier' && x.name === bindingName) {
            hit = true
            return
          }
          for (const k of Object.keys(x)) {
            if (k === 'parent') continue
            const c = x[k]
            if (Array.isArray(c)) c.forEach(walk)
            else if (c && typeof c === 'object' && typeof c.type === 'string') walk(c)
          }
        }
        walk(n)
        return hit
      }
      const visit = (n) => {
        if (translated || n === null || typeof n !== 'object' || seen.has(n)) return
        seen.add(n)
        // toFsError(err, path)
        if (
          n.type === 'CallExpression' &&
          n.callee.type === 'Identifier' &&
          TRANSLATORS.has(n.callee.name) &&
          n.arguments.some(references)
        )
          translated = true
        // ArbiterError.fromKey(err.code, ...) / SomeError.from(err)
        if (
          n.type === 'CallExpression' &&
          n.callee.type === 'MemberExpression' &&
          n.callee.object.type === 'Identifier' &&
          ERROR_CLASSES.has(n.callee.object.name) &&
          n.arguments.some(references)
        )
          translated = true
        // new ArbiterError(code, String(err))
        if (
          n.type === 'NewExpression' &&
          n.callee.type === 'Identifier' &&
          ERROR_CLASSES.has(n.callee.name) &&
          n.arguments.some(references)
        )
          translated = true
        for (const key of Object.keys(n)) {
          if (key === 'parent') continue
          const child = n[key]
          if (Array.isArray(child)) child.forEach((c) => visit(c))
          else if (child && typeof child === 'object' && typeof child.type === 'string')
            visit(child)
        }
      }
      visit(handler.body)
      return translated
    }

    /** `throw err` (bare) or the raw error written to console / process.stdout|stderr. */
    function bindingLeaksRaw(handler, bindingName) {
      let leaks = false
      const seen = new Set()
      const isBinding = (n) => n && n.type === 'Identifier' && n.name === bindingName
      /** `err`, `String(err)`, `err.message`, `` `${err}` `` — the raw text, unwrapped. */
      const isRawUse = (n) => {
        if (!n || typeof n !== 'object') return false
        if (isBinding(n)) return true
        if (
          n.type === 'CallExpression' &&
          n.callee.type === 'Identifier' &&
          n.callee.name === 'String'
        )
          return n.arguments.some(isBinding)
        if (n.type === 'MemberExpression' && isBinding(n.object)) return true
        if (n.type === 'TemplateLiteral') return n.expressions.some(isRawUse)
        if (n.type === 'BinaryExpression') return isRawUse(n.left) || isRawUse(n.right)
        if (n.type === 'ConditionalExpression')
          return isRawUse(n.consequent) || isRawUse(n.alternate)
        return false
      }
      const isStdio = (callee) =>
        callee.type === 'MemberExpression' &&
        ((callee.object.type === 'Identifier' && callee.object.name === 'console') ||
          (callee.object.type === 'MemberExpression' &&
            callee.object.object.type === 'Identifier' &&
            callee.object.object.name === 'process' &&
            callee.object.property.type === 'Identifier' &&
            ['stdout', 'stderr'].includes(callee.object.property.name)))
      const visit = (n) => {
        if (leaks || n === null || typeof n !== 'object' || seen.has(n)) return
        seen.add(n)
        // Bare re-throw: surfaces the NodeJS stack verbatim.
        if (n.type === 'ThrowStatement' && isBinding(n.argument)) leaks = true
        // Raw error text straight to the user's terminal.
        if (n.type === 'CallExpression' && isStdio(n.callee) && n.arguments.some(isRawUse))
          leaks = true
        for (const key of Object.keys(n)) {
          if (key === 'parent') continue
          const child = n[key]
          if (Array.isArray(child)) child.forEach((c) => visit(c))
          else if (child && typeof child === 'object' && typeof child.type === 'string')
            visit(child)
        }
      }
      visit(handler.body)
      return leaks
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== 'string' || !FS_MODULES.has(node.source.value)) return
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier') fsFunctionBindings.add(spec.local.name)
          else fsModuleBindings.add(spec.local.name)
        }
      },
      'TryStatement:exit'(node) {
        const handler = node.handler
        // No binding → nothing can escape. A deliberate `catch {}` is not this rule's target.
        if (!handler || handler.param === null || handler.param.type !== 'Identifier') return
        if (!containsFsCall(node.block)) return
        const name = handler.param.name
        if (bindingIsTranslated(handler, name)) return
        if (!bindingLeaksRaw(handler, name)) return
        context.report({ node: handler, messageId: 'untranslatedErrno' })
      },
    }
  },
}

export default rule
