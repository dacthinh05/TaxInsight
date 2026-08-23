import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@main': path.resolve(__dirname, 'src/main')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Tách vendor bundle để chunk chính nhỏ hơn ngưỡng cảnh báo 500KB.
        // Dạng function để bắt cả react/jsx-runtime mà các component import ngầm.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('lucide-react')) return 'vendor-lucide';
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) || id.includes('jsx-runtime')) {
            return 'vendor-react';
          }
          if (id.includes('clsx') || id.includes('tailwind-merge')) return 'vendor-utils';
          return undefined;
        }
      }
    }
  }
});
