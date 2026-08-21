import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    build: { rollupOptions: { input: resolve('src/preload/index.ts') } },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          splash: resolve('src/renderer/splash/index.html'),
          settings: resolve('src/renderer/settings/index.html'),
          logs: resolve('src/renderer/logs/index.html'),
          about: resolve('src/renderer/about/index.html'),
        },
      },
    },
  },
})
