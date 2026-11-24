import eslint from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['build/**', '.react-router/**', 'drizzle/migrations/**'],
  },
  {
    // Server/build skripty mimo TS (.mjs/.js) běží v Node — dej jim node globals
    // (jinak `process` apod. hlásí no-undef, např. instrument.server.mjs).
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Kosmetické pravidlo — apostrofy/uvozovky v JSX textu se renderují
      // korektně; vypnuto, ať legal/marketing copy nemusí escapovat entity.
      'react/no-unescaped-entities': 'off',
      // Nehlásit záměrně nepoužité argumenty/proměnné s prefixem `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
    settings: { react: { version: 'detect' } },
  }
);
