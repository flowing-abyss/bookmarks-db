import recommended from 'stylelint-config-recommended';

export default {
  ...recommended,
  ignoreFiles: ['**/node_modules/**', '**/.pi/**', '**/.worktrees/**', '**/.pi-lens/**'],
  rules: {
    ...recommended.rules,
  },
};
