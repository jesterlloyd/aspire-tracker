import { defineConfig } from 'vite'
import { listSceneFiles } from './masthead/src/lib/sceneManifest.mjs'
import react from '@vitejs/plugin-react'
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
// built-in SVG scenery renders instead. MASTHEAD-PHASE-1: the scan lives in
// the package now.
const here = dirname(fileURLToPath(import.meta.url));
const mastheadSceneFiles = listSceneFiles(join(here, 'public', 'masthead'));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // MASTHEAD-PHASE-1: the masthead is a package inside this repo, on its way to
    // being its own program (docs/product/MASTHEAD_SERVICE_PLAN.md). The app
    // reaches it through one alias so the move out is a one-line change.
    alias: { '@masthead': join(here, 'masthead', 'src') },
  },
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha),
    'import.meta.env.VITE_BUILD_ENV': JSON.stringify(buildEnv),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(buildTime),
    __MASTHEAD_SCENE_FILES__: JSON.stringify(mastheadSceneFiles),
  },
})
