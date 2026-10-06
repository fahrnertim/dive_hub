import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // /mcp too: the AI access panel shows the base URL's /mcp as the endpoint (ADR 0035).
    proxy: { '/api': 'http://127.0.0.1:3000', '/mcp': 'http://127.0.0.1:3000' },
  },
});
