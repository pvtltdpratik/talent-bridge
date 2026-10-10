import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the SPA talks to the API through this proxy, so no CORS setup is needed locally.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_DEV_API_TARGET || 'http://localhost:4000', changeOrigin: true } },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // function form (required by Rolldown): keep vendor code in a few stable, cacheable chunks
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/.test(id)) return 'react';
          if (/node_modules[\/](@mui|@emotion)[\/]/.test(id)) return 'mui';
          if (/node_modules[\/](recharts|d3-[a-z-]+|victory-vendor)[\/]/.test(id)) return 'charts';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
});
