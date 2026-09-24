import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5178,
    strictPort: true,
    // linked worktree 落在仓库子目录里，不忽略的话 worktree 内改动会触发主仓整页刷新
    watch: { ignored: ['**/.worktrees/**'] },
  },
  build: { target: 'esnext', chunkSizeWarningLimit: 2000 },
})
