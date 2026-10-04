import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5173, strictPort: true, allowedHosts: ['frontend'], proxy: {
    '/api': { target: process.env.RESOURCE_SERVER_URL || 'http://localhost:8081', changeOrigin: true },
  } },
});
