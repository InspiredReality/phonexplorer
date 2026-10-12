import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 3100,
    proxy: {
      '/api': 'https://phonexplorer-production.up.railway.app',
    },
  },
})
