import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  base: './',
  build: { modulePreload: false },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
})
