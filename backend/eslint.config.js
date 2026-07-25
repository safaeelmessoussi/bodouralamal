import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Prisma's generated client is build output, not authored source.
  { ignores: ['src/generated/**', 'dist/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore marks a parameter kept for signature reasons —
      // Express identifies middleware and error handlers by arity, so unused
      // positional params are load-bearing, not dead code.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all' },
      ],
    },
  },
  {
    // SRS §16.2: no `any` in service/repository layers (hard error there).
    files: ['src/services/**/*.ts', 'src/repositories/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
