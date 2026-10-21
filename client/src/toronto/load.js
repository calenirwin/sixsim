// Transport limits only: CTL1/schema/coordinate interpretation remains in the runtime reader.
export const TILE_MAX_BYTES = 16_384;
export const TILE_TIMEOUT_MS = 15_000;

export async function loadTileBytes(url, { timeoutMs = TILE_TIMEOUT_MS, maxBytes = TILE_MAX_BYTES } = {}) {
  const controller = new AbortController();
  let reader, timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Tile download timed out. Check your connection and reload.'));
    }, timeoutMs);
  });
  const download = async () => {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Tile request failed (HTTP ${response.status}).`);
    const declared = response.headers.get('content-length');
    if (declared && Number(declared) > maxBytes) throw new Error('Tile exceeds the demo download limit.');
    if (!response.body) throw new Error('Tile response is empty.');
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error('Tile exceeds the demo download limit.');
      chunks.push(value);
    }
    if (length < 8) throw new Error('Tile response is incomplete.');
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (new DataView(bytes.buffer).getUint32(0, true) !== 0x43544c31) {
      throw new Error('Server returned an invalid tile. Check the static package path.');
    }
    return bytes.buffer;
  };
  try { return await Promise.race([download(), timeout]); }
  finally {
    clearTimeout(timer);
    controller.abort();
    await reader?.cancel().catch(() => {});
  }
}
