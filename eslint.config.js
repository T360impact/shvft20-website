// ESLint for the site and the portal: the recommended rules, as browser ES
// modules. Vendored libraries are other people's code and are left alone.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['portal/vendor/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
  { files: ['portal/tests/**', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
  // site.js and the readiness check are classic scripts, not modules.
  { files: ['site.js', 'readiness/**/*.js'], languageOptions: { sourceType: 'script' } },
];
