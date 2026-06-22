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
  optimizeDeps: {
    exclude: ['msw/browser'],
  },
  server: {
    proxy: {
      '/v1': process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8080',
      '/health': process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8080',
      '/readyz': process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8080',
    },
  },
})
