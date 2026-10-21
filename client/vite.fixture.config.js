import { defineConfig, mergeConfig } from 'vite';
import config from './vite.config.js';

// Separate entry/output preserves the real city client and its asset contract.
export default mergeConfig(config, defineConfig({
  publicDir: false,
  build: { outDir: 'dist-fixture', rolldownOptions: { input: 'fixture.html' } },
}));
