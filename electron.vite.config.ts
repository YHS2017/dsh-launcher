import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        // 必须产出 CJS 且用 .cjs 扩展名。Electron 默认开启 sandbox，
        // 而 sandboxed preload 不支持 ESM——打成 .mjs 会静默失效：
        // 不报错、窗口照常显示，但 contextBridge 从未执行，
        // window.launcher 是 undefined，所有 IPC 功能全哑。
        // 本包是 type:module，所以扩展名不能用 .js，否则会被当作 ESM。
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
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
