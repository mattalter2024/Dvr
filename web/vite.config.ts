import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/hls.js')) return 'hls-vendor';
          if (id.includes('node_modules/react')) return 'react-vendor';
          if (id.includes('node_modules/lucide-react')) return 'icons-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8096',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8096',
        ws: true,
      },
    },
  },
});
