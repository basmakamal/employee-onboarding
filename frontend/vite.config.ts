import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  server: {
    port: 3000,
    // Same-origin API in dev: the browser only ever talks to :3000.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
