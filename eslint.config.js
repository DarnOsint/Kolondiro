import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

const SHARED_RULES = {
  'no-unused-vars':   ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-console':       ['warn', { allow: ['warn', 'error'] }],
  'no-debugger':      'error',
  'prefer-const':     'warn',
  'no-var':           'error',
}

const REACT_RULES = {
  ...reactHooks.configs.recommended.rules,
  'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  // setState in useEffect is the standard data-fetching pattern in this codebase
  'react-hooks/set-state-in-effect': 'off',
}

export default [
  // ── Global ignores ─────────────────────────────────────────────────────────
  {
    ignores: ['dist', 'node_modules', 'scripts', '.venv'],
  },

  // ── JS / JSX files ─────────────────────────────────────────────────────────
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks':   reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...REACT_RULES,
      ...SHARED_RULES,
      'no-undef': 'error',
    },
  },

  // ── TS / TSX files ─────────────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks':        reactHooks,
      'react-refresh':      reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...REACT_RULES,
      ...SHARED_RULES,
      // Turn off base rules that TS versions replace
      'no-unused-vars':                        'off',
      '@typescript-eslint/no-unused-vars':     ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any':    'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Allow 'satisfies' keyword and other modern TS
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  prettier,
]
