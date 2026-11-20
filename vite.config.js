import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时前端跑 Vite，接口转发到本机 HTTPS 服务（自签名证书，secure: false）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://127.0.0.1:9000',
        changeOrigin: false,
        secure: false,
      },
    },
  },
})
