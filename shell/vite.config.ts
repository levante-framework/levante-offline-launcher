import { execSync } from 'node:child_process';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';

function gitShort(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'nogit';
  }
}

const appBuild = `${gitShort()}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;

export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify(appBuild),
  },
  plugins: [
    vue(),
    // The core-tasks bundle (via papaparse and friends) touches process, Buffer, global
    // and node:stream; the dashboard ships the same polyfills.
    nodePolyfills({ globals: { Buffer: true, global: true, process: true }, protocolImports: true }),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'LEVANTE Offline Launcher',
        short_name: 'LEVANTE',
        description: 'Offline administration of LEVANTE core tasks',
        start_url: '/',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#f6f8fb',
        theme_color: '#2f4e8c',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      injectManifest: {
        // Only the app shell is precached at build time; asset packs are downloaded at
        // provisioning time into Cache Storage (see src/sw.ts and src/offline/packStore.ts).
        globPatterns: ['**/*.{js,css,html,ico,svg,png,webmanifest,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    // core-tasks is a `file:` dependency (symlink). Keep the symlink path so imports the
    // polyfill plugin injects into its bundle resolve from this package's node_modules.
    preserveSymlinks: true,
  },
  server: {
    host: true,
    fs: { allow: ['..'] },
  },
});
