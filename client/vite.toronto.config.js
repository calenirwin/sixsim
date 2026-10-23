import { defineConfig, mergeConfig } from 'vite';
import config from './vite.config.js';
import fs from 'node:fs';

const notices = {
  'LICENSE.txt': fs.readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'),
  'THIRD_PARTY_NOTICES.txt': 'three.js and OrbitControls (MIT)\n\n' + fs.readFileSync(new URL('../node_modules/three/LICENSE', import.meta.url), 'utf8'),
};

export default mergeConfig(config, defineConfig({
  publicDir: false,
  plugins: [{
    name: 'toronto-notices',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = new URL(req.url, 'http://localhost').pathname.slice(1);
        if (!Object.hasOwn(notices, name)) return next();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(notices[name]);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(notices)) this.emitFile({ type: 'asset', fileName, source });
    },
  }],
  build: {
    outDir: 'dist-toronto', assetsInlineLimit: 0,
    rolldownOptions: { input: ['toronto.html', 'corridor.html'] },
  },
}));
