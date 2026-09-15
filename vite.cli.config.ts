import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * 命令行入口单独打包。
 *
 * 不塞进 electron-vite 的 main 构建里当第二个入口：多入口时 rollup 会把两边共用的
 * 模块（paths、runtime-resolver 等）拆成公共 chunk 落在 out/main/，而 CLI 产物是要
 * 作为松散文件复制到安装目录 bin/ 下、由内置 Node 直接执行的——搬走之后那些 chunk
 * 就找不到了。单入口 SSR 构建产物只有一个文件，没有这个问题。
 *
 * 扩展名用 .mjs：安装目录里没有 package.json（它在 app.asar 内，纯 Node 读不到），
 * 不显式标明模块类型的话 Node 会按 CJS 解析，ESM 语法直接报错。
 */
export default defineConfig({
  build: {
    ssr: resolve('src/cli/dsh-cli.ts'),
    outDir: 'out/cli',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'dsh-cli.mjs' },
    },
  },
})
