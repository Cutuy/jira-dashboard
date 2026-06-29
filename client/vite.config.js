import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': `http://localhost:${process.env.PORT || 3006}` }
  },
  build: { outDir: '../public-spa' }
})
