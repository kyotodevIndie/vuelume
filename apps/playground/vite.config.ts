import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Built as static assets and served by @vuelume/vite-plugin under /__vuelume/.
export default defineConfig({
  base: '/__vuelume/',
  plugins: [vue()],
  build: { outDir: 'dist', emptyOutDir: true },
})
