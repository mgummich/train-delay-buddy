import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^\/v1\/journeys\/[^/]+\/summary/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^\/v1\/stations/,
            handler: 'NetworkOnly',
          },
        ],
        navigateFallback: '/index.html',
      },
      manifest: false, // served from public/manifest.json
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/v1': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
      '/readyz': 'http://localhost:8080',
    },
  },
})
