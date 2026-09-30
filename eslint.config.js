import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'examples/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `noUncheckedIndexedAccess` is on: `items[i]!` after an explicit bounds check is the
      // idiomatic way to narrow, so non-null assertions are allowed.
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
)
