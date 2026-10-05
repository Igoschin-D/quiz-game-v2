import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const API = process.env.API_URL ?? 'http://localhost:3001';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: API, xfwd: true },
      '/socket.io': { target: API, ws: true, xfwd: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
}));
