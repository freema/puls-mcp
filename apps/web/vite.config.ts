import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: {
    host: true,
    allowedHosts: true,
  },
  ssr: {
    noExternal: ['lucide-react', 'recharts'],
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, 'app'),
    },
    dedupe: ['react', 'react-dom'],
  },
});
