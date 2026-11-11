import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './': the build runs from any folder, opened as a plain file tree
export default defineConfig({
  base: './',
  plugins: [react()],
})
