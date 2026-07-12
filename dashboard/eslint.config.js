// Narrow, high-value rule set only — catches real bugs (broken hooks rules,
// undefined/unused variables), not style. Deliberately does not include
// eslint-plugin-react-hooks's newer compiler-oriented rules (purity,
// immutability, set-state-in-render, etc.) or any stylistic/formatting
// rules — those would flag a large pre-existing backlog across a codebase
// that has never been linted, for little bug-catching value. Revisit this
// list narrowly, rule by rule, rather than swapping in a "recommended"
// bundle wholesale.
//
// `npm run lint` pins --max-warnings to the current baseline (7, as of this
// writing) as a ratchet: it fails if warnings increase, but doesn't require
// the pre-existing backlog to be fixed before this lands. Lower that number
// as warnings get cleaned up; never raise it silently.
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  { ignores: ['dist/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        // Injected by vite.config.js's `define` from the root VERSION file.
        __APP_VERSION__: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['api/**/*.js', 'vite.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]
