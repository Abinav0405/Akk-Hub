import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5190,
    // Transform the shell and every role's first screens as soon as the server starts.
    warmup: {
      clientFiles: [
        './src/main.jsx',
        './src/app/AppRoutes.jsx',
        './src/pages/**/*.jsx',
        './src/ui/**/*.jsx',
        // Ported module screens are huge (Timesheet admin ≈ 14k lines); compile them up front
        // so the first visit in dev doesn't take several seconds.
        './src/modules/*/pages/*.jsx',
      ],
    },
  },
  // Scan every source file up front so Vite pre-bundles all dependencies once. Without this,
  // opening a module screen for the first time discovers new deps mid-session, Vite
  // re-optimizes and force-reloads the page — the "extremely slow" page switching in dev.
  optimizeDeps: {
    entries: ['index.html', 'src/**/*.{js,jsx}'],
    include: [
      'react',
      'react-dom/client',
      'react-router-dom',
      '@tanstack/react-query',
      '@supabase/supabase-js',
      'framer-motion',
      'lucide-react',
      'sonner',
      'date-fns',
      'clsx',
      'tailwind-merge',
      'class-variance-authority',
      '@radix-ui/react-dialog',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-label',
      '@radix-ui/react-slot',
      '@radix-ui/react-separator',
      '@capacitor/core',
      '@capacitor/app',
    ],
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // PDF, spreadsheet, QR, maps, face recognition and chart packages are all loaded
          // from explicit feature-level dynamic imports. Do not pull them into named shared
          // chunks here: Rollup then adds modulepreload links for those chunks to index.html,
          // making every first paint download tools that most users never open.
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('@tanstack/react-query')) return 'vendor-react-query'
          // Keep react, react-dom, react-router and scheduler together — splitting breaks hooks in prod.
          if (
            /node_modules[/\\]react[/\\]/.test(id) ||
            /node_modules[/\\]react-dom[/\\]/.test(id) ||
            /node_modules[/\\]react-router/.test(id) ||
            /node_modules[/\\]scheduler[/\\]/.test(id)
          ) {
            return 'vendor-react'
          }
          return undefined
        },
      },
    },
  },
})
