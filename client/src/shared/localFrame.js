// Same local metric convention as geo.js, with an explicit origin for bounded import tools.
// This does not change the default NYC simulation or API origin.
export function localFrame({ lat, lon }) {
  if (!Number.isFinite(lat) || Math.abs(lat) >= 85 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new Error('Invalid local-frame origin');
  }
  const north = 111132;
  const east = 111320 * Math.cos(lat * Math.PI / 180);
  return {
    project: (longitude, latitude) => [(longitude - lon) * east, -(latitude - lat) * north],
    unproject: (x, z) => [x / east + lon, -z / north + lat],
  };
}
