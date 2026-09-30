import vue from '@vitejs/plugin-vue'
import vuelume from '@vuelume/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  // `vuelume()` is dev-only (apply: 'serve'): production builds are untouched.
  // Remove it and this is a plain Vue app again.
  plugins: [vuelume(), vue()],
})
