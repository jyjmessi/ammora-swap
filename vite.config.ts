import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `base: './'` emits relative asset URLs, so the same build works at
// https://<user>.github.io/<repo>/ and on any other static host or sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
})
