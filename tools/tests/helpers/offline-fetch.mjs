// Install before importing the core shim: it captures this guard as nodeFetch.
// Absolute requests fail before any network I/O, including Request/URL objects.
export const externalAttempts = [];
globalThis.fetch = async input => {
  const target = input?.url ?? String(input);
  externalAttempts.push(target);
  throw new Error(`Offline test blocked fetch: ${target}`);
};
