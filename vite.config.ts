import { defineConfig } from 'vite';
import { resolve } from 'path';
import { bidsPhysioPlugin } from './server/bids-physio-plugin';

export default defineConfig({
  plugins: [bidsPhysioPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        quality: resolve(__dirname, 'quality.html'),
      },
    },
  },
});
