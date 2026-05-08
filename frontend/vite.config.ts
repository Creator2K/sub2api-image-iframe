import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Keep production assets relative so the page still loads CSS/JS when it is
  // opened by Sub2API in a new tab or deployed under a non-root path.
  base: './',
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
