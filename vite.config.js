import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
const vercelEnv = process.env.VERCEL_ENV;
const buildSha = vercelSha
  ? vercelSha.slice(0, 7)
  : (vercelEnv ? 'unavailable' : 'dev');
const buildEnv = vercelEnv || 'development';
// ASPIRE-GENERAL-SETTINGS-1: build timestamp for Settings → General → About.
// Safe, non-secret metadata computed at build time (ISO 8601, UTC).
const buildTime = new Date().toISOString();

// MASTHEAD-SCENE-2: the masthead city-scene artwork is discovered from
// public/masthead/ at dev/build start - drop prepared <City>_<Scene>.webp
// files there (npm run masthead:prepare) and restart to register them. The
// list is injected as a global constant so the runtime never needs to probe
// or enumerate the folder over HTTP. Missing folder → empty list → the
// built-in SVG scenery renders instead.
const mastheadSceneFiles = (() => {
  try {
    // SCENE-3: recursive - city packs live in one subfolder per city
    // (public/masthead/LA/LA_Day.webp); flat files still count.
    return readdirSync(join(dirname(fileURLToPath(import.meta.url)), 'public', 'masthead'), { recursive: true })
      .map(f => String(f).replace(/\\/g, '/'))
      .filter(f => /\.(webp|png|jpe?g)$/i.test(f))
      .sort();
  } catch {
    return [];
  }
})();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha),
    'import.meta.env.VITE_BUILD_ENV': JSON.stringify(buildEnv),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(buildTime),
    __MASTHEAD_SCENE_FILES__: JSON.stringify(mastheadSceneFiles),
  },
})
