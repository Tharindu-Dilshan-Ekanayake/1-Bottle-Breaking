import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

import { PROD_ENV } from './src/bloxity/env.js'

/** A local Boxity stack: the API, the play (matchmaker) service and the portal. */
const LOCAL_BLOXITY_ENV = {
  env: 'local',
  apiUrl: 'http://localhost:4000',
  playUrl: 'http://localhost:2567',
  portalUrl: 'http://localhost:3000',
  staticUrl: PROD_ENV.staticUrl,
}

/**
 * `vite dev` only (`apply: 'serve'`, never in a build): tells the Boxity SDK - and
 * src/bloxity/env.js - which environment to use, by injecting `window.BLOXITY_ENV`
 * ahead of every other script (so ahead of the SDK tag).
 *
 * Defaults to a local Boxity stack. BLOXITY_DEV_ENV=prod (in the shell, or in
 * client/.env) develops against production instead: then production is injected explicitly, because with no
 * BLOXITY_ENV at all the SDK, seeing localhost, would repoint its API and login at the
 * Vite server and login could never succeed.
 *
 * Production builds get nothing: the page Boxity hosts the game in provides it, or the
 * SDK uses production.
 */
function bloxityDevEnv(choice) {
  return {
    name: 'bloxity-dev-env',
    apply: 'serve',
    transformIndexHtml() {
      const env = choice === 'prod' ? PROD_ENV : LOCAL_BLOXITY_ENV
      return [{ tag: 'script', children: `window.BLOXITY_ENV = ${JSON.stringify(env)};`, injectTo: 'head-prepend' }]
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [bloxityDevEnv(process.env.BLOXITY_DEV_ENV || loadEnv(mode, process.cwd(), '').BLOXITY_DEV_ENV), react(), tailwindcss()],
  resolve: {
    alias: {
      // Game rules and lobby layout, shared with the server.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    // ../shared lives outside the client root.
    fs: { allow: ['..'] },
  },
  build: {
    // three.js alone is ~700 KB minified; the warning is about raw size, not gzip.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Vendor chunks change rarely, so they stay cached across game updates. The
        // staircase stage and the Colyseus client stay their own lazy chunks.
        codeSplitting: {
          groups: [
            { name: 'colyseus', test: /node_modules[\\/]@colyseus[\\/]/, priority: 40 },
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 30 },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
}))
