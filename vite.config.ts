import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from /<repo>/, so the base path comes from the environment.
const base = process.env.LEELA_BASE ?? '/'

export default defineConfig({
  base,
  // Shown in the admin panel, so it's clear which version a phone is running.
  define: { __APP_VERSION__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'LAPdiary',
        short_name: 'LAPdiary',
        description: 'Your baby’s day, shared by the whole family.',
        // Dark splash screen while the app opens: no white flash.
        theme_color: '#0e1120',
        background_color: '#0e1120',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Shows Sweet spot reminders and opens Leela when one is tapped (public/push-sw.js).
        importScripts: ['push-sw.js'],
        navigateFallback: `${base}index.html`,
        // Never cache API traffic; the app keeps its own offline copy.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
      },
    }),
  ],
  server: { host: true },
})
