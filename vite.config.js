import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
const vercelEnv = process.env.VERCEL_ENV;
const buildSha = vercelSha
  ? vercelSha.slice(0, 7)
  : (vercelEnv ? 'unavailable' : 'dev');
const buildEnv = vercelEnv || 'development';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha),
    'import.meta.env.VITE_BUILD_ENV': JSON.stringify(buildEnv),
  },
})
