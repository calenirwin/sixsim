// Rendering support belongs to the map configuration, never to traffic presence.
export const NYC_RENDERING = Object.freeze({ remoteProtocol: 'valdrada.render/0', browserReplay: 'atrk/1', assetProfile: 'nyc' });
export const TORONTO_RENDERING = Object.freeze({ remoteProtocol: null, browserReplay: 'atrk/1', assetProfile: 'toronto-massing-scheduled' });
export function supportsRemoteRenderer(world) {
  return world.renderCapabilities?.remoteProtocol === 'valdrada.render/0' && world.renderCapabilities?.assetProfile === 'nyc';
}
