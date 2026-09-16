import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw-custom.ts',
      manifest: {
        name: 'Cyberville RestaurantOS',
        short_name: 'Cyberville',
        description: 'Restaurant management system powered by Cyberville',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core React — always needed immediately
          if (id.includes('node_modules/react/') || 
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/') ||
              id.includes('node_modules/scheduler/')) {
            return 'vendor-react'
          }
          // Supabase — needed at login
          if (id.includes('node_modules/@supabase/')) {
            return 'vendor-supabase'
          }
          // Lucide icons — bundle all icons together, not 200 tiny files
          if (id.includes('node_modules/lucide-react/')) {
            return 'vendor-icons'
          }
          // Recharts — only Reports/Analytics
          if (id.includes('node_modules/recharts/') || 
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-vendor/')) {
            return 'vendor-charts'
          }
          // PDF/canvas — only Reports export
          if (id.includes('node_modules/html2canvas/') || 
              id.includes('node_modules/jspdf/')) {
            return 'vendor-pdf'
          }
          // DOMPurify — used in several pages
          if (id.includes('node_modules/dompurify/')) {
            return 'vendor-purify'
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/hooks/**'],
      exclude: ['src/lib/supabase.js', 'node_modules']
    }
  }
})
