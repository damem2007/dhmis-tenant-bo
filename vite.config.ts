import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    allowedHosts: ['.dhmis.local'],
    proxy: {
      '/v1': process.env.VITE_API_PROXY || 'http://127.0.0.1:5137',
      '/health': process.env.VITE_API_PROXY || 'http://127.0.0.1:5137',
    },
  },
});
