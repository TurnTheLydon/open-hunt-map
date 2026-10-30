import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Open Hunt Map',
        short_name: 'Open Hunt',
        description: 'Free, open-source map of land ownership, public land, and game lands.',
        theme_color: '#b35c0c',
        background_color: '#fbfaf7',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // App shell only. Tiles are large and range-requested; offline regions will be
        // stored per county in the Origin Private File System instead.
        globPatterns: ['**/*.{js,mjs,css,html,svg}'],
        globIgnores: ['tiles/**'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/protomaps\.github\.io\/basemaps-assets\//,
            handler: 'CacheFirst',
            options: { cacheName: 'map-assets', expiration: { maxEntries: 500 } },
          },
        ],
      },
    }),
  ],
})
