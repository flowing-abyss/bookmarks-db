import globals from 'globals';

export default [
  {
    name: 'browser-globals',
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
    },
  },
  {
    name: 'rules',
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    name: 'ignores',
    ignores: [
      'node_modules/',
      'dist/',
      '.pi/',
      '.pi-lens/',
      '.superpowers/',
      '.worktrees/',
      'docs/',
    ],
  },
];
