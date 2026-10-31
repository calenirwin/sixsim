import {cityAssetBuild,coverAssetBuild,roadAssetBuild} from './tools/hosting/city-assets.mjs';
import { defineConfig, mergeConfig } from 'vite';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import config from './vite.config.js';
const commit=process.env.GITHUB_SHA || execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Publication requires a full commit SHA');
const sources=['toronto/district-provenance.json','toronto/network-provenance.json','toronto/green-spaces-provenance.json','toronto/land-cover-provenance.json','toronto/city-terrain/provenance.json','toronto/city-buildings/provenance.json','toronto/city-cover/provenance.json','toronto/city-roads/provenance.json','transit/provenance.json'].map(name=>JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`,import.meta.url))));
export default mergeConfig(config,defineConfig({
  base:'/sixsim/',publicDir:false,
  define:{'import.meta.env.VITE_PUBLISHED_CITY':JSON.stringify('toronto')},
  build:{outDir:'dist-publish',assetsInlineLimit:0},
  plugins:[cityAssetBuild(),coverAssetBuild(),roadAssetBuild(),{
    name:'publication-provenance',
    generateBundle(){
      for(const name of ['LICENSE','LICENSING.md','ACKNOWLEDGEMENTS.md'])this.emitFile({type:'asset',fileName:name+'.txt',source:fs.readFileSync(new URL('../'+name,import.meta.url),'utf8')});
      this.emitFile({type:'asset',fileName:'DATA_SOURCES.json',source:JSON.stringify({attribution:'Contains information licensed under the Open Government Licence – Toronto.',sources},null,2)});
      this.emitFile({type:'asset',fileName:'deployment.json',source:JSON.stringify({commit,city:'toronto',mode:'scheduled-playback',serviceDay:'20261022'},null,2)});
    },
  }],
}));
