import { RuleTester } from 'eslint'
import rule from '../../eslint-rules/no-raw-cli-strings.js'

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

// RuleTester.run registers its own describe/it at the top level
tester.run('no-raw-cli-strings (#656)', rule, {
  valid: [
    // t() calls are allowed
    { code: "console.log(t('commands.init.success'))" },
    // Pure-expression template literal (empty quasis) is allowed
    { code: 'console.log(`${t("key")}`)' },
    { code: 'process.stdout.write(`${t("key")}`)' },
    // Variable reference allowed
    { code: 'console.log(message)' },
    // process.stdout with t()
    { code: "process.stdout.write(t('key') + '\\n')" },
    // Non-output calls with literals allowed
    { code: "const x = 'hello'" },
    { code: "someFunction('hello')" },
    // ArbiterError with t()
    { code: "throw new ArbiterError('E_CODE', t('errors.E_CODE.message'))" },
    // UserFacingError with t() at index 0
    { code: "throw new UserFacingError(t('errors.E_CODE.message'))" },
    // console.log with number
    { code: 'console.log(42)' },
    // console.log with boolean
    { code: 'console.log(true)' },
  ],
  invalid: [
    // Raw string in console.log
    {
      code: "console.log('hello world')",
      errors: [{ messageId: 'rawString' }],
    },
    // Raw string in console.error
    {
      code: "console.error('something failed')",
      errors: [{ messageId: 'rawString' }],
    },
    // Raw string in console.warn
    {
      code: "console.warn('warning message')",
      errors: [{ messageId: 'rawString' }],
    },
    // Raw string in console.info
    {
      code: "console.info('info message')",
      errors: [{ messageId: 'rawString' }],
    },
    // Raw string in process.stdout.write
    {
      code: "process.stdout.write('output\\n')",
      errors: [{ messageId: 'rawString' }],
    },
    // Raw string in process.stderr.write
    {
      code: "process.stderr.write('error output\\n')",
      errors: [{ messageId: 'rawString' }],
    },
    // Raw string as ArbiterError message (second arg)
    {
      code: "throw new ArbiterError('E_CODE', 'raw error message')",
      errors: [{ messageId: 'rawString' }],
    },
    // Raw string as UserFacingError message (first arg)
    {
      code: "throw new UserFacingError('raw error message')",
      errors: [{ messageId: 'rawString' }],
    },
    // Template literal with non-empty static text in console output
    {
      code: 'console.log(`hello world`)',
      errors: [{ messageId: 'rawString' }],
    },
    {
      code: 'console.log(`prefix ${t("key")} suffix`)',
      errors: [{ messageId: 'rawString' }],
    },
    {
      code: 'process.stdout.write(`output: ${value}\\n`)',
      errors: [{ messageId: 'rawString' }],
    },
  ],
})
