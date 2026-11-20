// Dev-режим renderer в обычном браузере (архитектурный тест изоляции UI от Electron, ТЗ §5).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cspDevRelax } from './tools/vite-plugin-csp-dev'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), cspDevRelax()],
  build: {
    outDir: 'dist/browser',
    emptyOutDir: true,
  },
})
