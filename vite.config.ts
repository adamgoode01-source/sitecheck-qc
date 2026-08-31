import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the same build works from file:// (Electron) and capacitor://
  base: './',
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
