import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 8080,
    strictPort: true,
    // The SPA is served by Vite on 8080 while the real backend is the .NET
    // API on https://localhost:5001. Any request starting with these prefixes
    // is forwarded to the API in dev so the browser only ever talks to the
    // Vite dev server (no CORS noise for the app itself). `secure: false`
    // allows the https target even though Vite's dev server is plain http
    // and the API's dev cert is self-signed.
    proxy: {
      '/api': {
        target: 'https://localhost:5001',
        changeOrigin: true,
        secure: false
      },
      '/assets': {
        target: 'https://localhost:5001',
        changeOrigin: true,
        secure: false
      },
      '/cdn': {
        target: 'https://localhost:5001',
        changeOrigin: true,
        secure: false
      },
      '/scorm-content': {
        target: 'https://localhost:5001',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
