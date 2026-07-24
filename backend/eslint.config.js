import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Prisma's generated client is build output, not authored source.
  { ignores: ['src/generated/**', 'dist/**'] },
  ...tseslint.configs.recommended,
  {
    // SRS §16.2: no `any` in service/repository layers (hard error there).
    files: ['src/services/**/*.ts', 'src/repositories/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
