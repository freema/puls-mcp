import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '~': resolve(import.meta.dirname, 'app'),
      // Resolvuj workspace @puls/* balíky ze ZDROJE (src), ne z přeloženého
      // ./dist. Jejich exports mapuje `default → ./dist/*.js`, takže vitest
      // jinak natáhne potenciálně zastaralý build artifact (starý dist měl
      // v PLATFORM jinou sadu platforem). src = jediný zdroj pravdy.
      '@puls/db/schema': resolve(
        import.meta.dirname,
        '../../packages/db/src/schema.ts',
      ),
      '@puls/platform-core': resolve(
        import.meta.dirname,
        '../../packages/platform-core/src/index.ts',
      ),
      '@puls/shoptet-client': resolve(
        import.meta.dirname,
        '../../packages/shoptet-client/src/index.ts',
      ),
      '@puls/upgates-client': resolve(
        import.meta.dirname,
        '../../packages/upgates-client/src/index.ts',
      ),
    },
  },
});
