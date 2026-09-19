import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base 策略：
//  - dev（npm run dev / VS Code 调试）：根路径 '/'，页面走 vite dev server
//  - build（npm run build）：fnOS 网关前缀 '/app/sinong/'（后端兼容剥离，端口模式同样可用）
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  base: command === 'serve' ? '/' : '/app/sinong/',
  server: {
    port: 5173,
    proxy: {
      // 前端 /api/* 与附件 /att/* 转发到本地后端调试端口
      '/api': 'http://127.0.0.1:18099',
      '/att': 'http://127.0.0.1:18099',
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1200,
  },
}))
