import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const coreRoot = fileURLToPath(new URL('./src', import.meta.url))
const modulesRoot = fileURLToPath(new URL('../modules', import.meta.url))
const dependency = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_PROXY || 'http://localhost:8080'
  const wsTarget = proxyTarget.replace(/^http/, 'ws')

  return {
    plugins: [react()],
    resolve: {
      alias: [
        { find: '@core', replacement: coreRoot },
        { find: '@modules', replacement: modulesRoot },
        { find: /^react$/, replacement: dependency('./node_modules/react') },
        { find: /^react\/jsx-runtime$/, replacement: dependency('./node_modules/react/jsx-runtime.js') },
        { find: /^react-dom$/, replacement: dependency('./node_modules/react-dom') },
        { find: /^react-dom\/client$/, replacement: dependency('./node_modules/react-dom/client.js') },
        { find: /^react-router-dom$/, replacement: dependency('./node_modules/react-router-dom') },
      ],
    },
    server: {
      port: 5173,
      fs: {
        allow: ['..'],
      },
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true },
        '/uploads': { target: proxyTarget, changeOrigin: true },
        '/ws': { target: wsTarget, ws: true },
      },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/react-router')
            ) {
              return 'react'
            }
          },
        },
      },
    },
  }
})
