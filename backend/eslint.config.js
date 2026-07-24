import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    // SRS §16.2: no `any` in service/repository layers (hard error there).
    files: ['src/services/**/*.ts', 'src/repositories/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
