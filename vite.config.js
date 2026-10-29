import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverUrl = env.VITE_SERVER_URL?.trim();
  if (mode === 'production') {
    if (!serverUrl) throw new Error('VITE_SERVER_URL must be set to the HTTPS Socket.IO backend before a production build.');
    let backend;
    try { backend = new URL(serverUrl); } catch { throw new Error('VITE_SERVER_URL must be a valid absolute HTTPS URL.'); }
    if (backend.protocol !== 'https:' || !backend.hostname || backend.pathname !== '/' || backend.search || backend.hash || ['localhost','127.0.0.1','::1'].includes(backend.hostname)) {
      throw new Error('VITE_SERVER_URL must be a public HTTPS origin without a path.');
    }
  }
  return {
    plugins: [react()],
    server: { proxy: { '/socket.io': { target: 'http://127.0.0.1:3001', ws: true } } },
    build: { outDir: 'dist' }
  };
});
