import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import pkg from './package.json' with { type: 'json' };

/** Last commit's short hash and date (YYYY-MM-DD), for the About page. "unknown" outside a git checkout. */
function git(args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}
const COMMIT_HASH = git('rev-parse --short HEAD');
const COMMIT_DATE = git('log -1 --format=%cs');

const now = new Date();
const BUILD_DATE = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; // local date

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    __COMMIT_HASH__: JSON.stringify(COMMIT_HASH),
    __COMMIT_DATE__: JSON.stringify(COMMIT_DATE),
  },
  build: { outDir: 'dist' },
  plugins: [
    preact(),
    // Runs the Worker (src/worker) + local D1 inside `vite dev`, and builds it alongside the client.
    cloudflare(),
    VitePWA({
      // Never reload on its own: the app shows an "Update available" toast instead (PLAN: PWA).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/icon.svg'],
      manifest: {
        name: 'Pop Quiz',
        short_name: 'PQ',
        description: 'Take FCC amateur radio practice exams together and compare results.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#1d4ed8',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell, all three pools, and every figure so a started quiz works offline.
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
