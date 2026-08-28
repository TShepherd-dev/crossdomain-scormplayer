import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 8080,
    strictPort: true,
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
