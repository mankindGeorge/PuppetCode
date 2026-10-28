import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 两种构建目标：
//   npm run build       → dist-single/index.html  单文件，双击可直接打开，也供 Electron 打包使用
//   npm run build:web   → dist-web/               多文件产物，用于常规静态站点部署
// 开发时 npm run dev 启动 Vite 开发服务器（源码即 ES 模块，便于分文件调试）。
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist-web',
      emptyOutDir: true,
      target: 'es2020',
      cssCodeSplit: !single,
      assetsInlineLimit: single ? 1024 * 1024 : 4096,
      chunkSizeWarningLimit: 4096
    }
  };
});
