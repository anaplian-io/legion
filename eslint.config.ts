import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/coverage/',
      '**/dist/',
      'node_modules/',
      'src/types/*.guard.ts',
      'src/initialization.ts',
      '**/data/',
    ],
  },
  {
    files: ['**/*.{ts}'],
  },
  ...tseslint.configs.recommended,
);
