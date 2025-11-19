
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // We remove the explicit 'define' block for process.env because it overrides
  // the native import.meta.env behavior and can cause keys to be missing if
  // not present strictly at build time.
})
