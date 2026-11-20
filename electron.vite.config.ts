import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { cspDevRelax } from './tools/vite-plugin-csp-dev'

export default defineConfig({
  main: {
    build: { lib: { entry: 'src/platform/electron/main.ts' } },
  },
  preload: {
    build: { lib: { entry: 'src/platform/electron/preload.ts' } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), cspDevRelax()],
  },
})
