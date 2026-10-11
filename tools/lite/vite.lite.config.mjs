// LITE15: the client's own Vite config without copying public/ (the light build copies only what its scenes need)
import base from '../../client/vite.config.js';

export default { ...base, build: { ...(base.build || {}), copyPublicDir: false } };
