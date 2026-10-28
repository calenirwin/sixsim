import { defineConfig,mergeConfig } from 'vite';
import config from './vite.publish.config.js';
import fs from 'node:fs';
export default mergeConfig(config,defineConfig({
  base:'./',build:{outDir:'dist-space'},
  plugins:[{name:'static-space-card',generateBundle(){
    this.emitFile({type:'asset',fileName:'README.md',source:fs.readFileSync(new URL('./tools/hosting/SPACE_README.md',import.meta.url),'utf8')});
  }}],
}));
