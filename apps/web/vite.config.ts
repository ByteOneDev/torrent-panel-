import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En développement, l'API tourne sur le port 8080 (npm run dev à la racine lance les deux).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
