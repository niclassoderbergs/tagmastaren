
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, (process as any).cwd(), '')

  return {
    plugins: [react()],
    define: {
      // Explicitly inject the specific variable defined in Vercel without the VITE_ prefix
      // This allows the code to access process.env.GOOGLE_AI_API_KEY safely
      'process.env.GOOGLE_AI_API_KEY': JSON.stringify(env.GOOGLE_AI_API_KEY),
    }
  }
})
