import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        // Prefer MUTOPOS_API_URL; default 8088 when 8080 is taken by other sandboxes
        target: process.env.MUTOPOS_API_URL ?? 'http://127.0.0.1:8088',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  // Sandbox preview (https://rizky-mutopos.fural.space → :3000)
  preview: {
    host: '0.0.0.0',
    port: 3000,
    // Allow Fural sandbox domain (and any *.fural.space) through the reverse proxy
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.MUTOPOS_API_URL ?? 'http://127.0.0.1:8088',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
