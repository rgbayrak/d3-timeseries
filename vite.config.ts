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
});
