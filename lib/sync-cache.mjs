const DEFAULT_CACHE_MS = 12_000;

let snapshot = null;
let snapshotAt = 0;
let inFlight = null;
let generation = 0;

export function syncCacheTtlMs() {
  return Math.max(1_000, Math.min(30_000, Number(process.env.SEXTA_SYNC_CACHE_MS || DEFAULT_CACHE_MS)));
}

export function invalidateSyncCache() {
  generation += 1;
  snapshot = null;
  snapshotAt = 0;
}

export function getSyncCache(now = Date.now()) {
  if (!snapshot || now - snapshotAt >= syncCacheTtlMs()) return null;
  return snapshot;
}

export function getSyncInFlight() {
  return inFlight;
}

export function loadSyncCache(loader) {
  if (inFlight) return inFlight;
  const startedAtGeneration = generation;
  inFlight = Promise.resolve()
    .then(loader)
    .then(value => {
      if (startedAtGeneration === generation) {
        snapshot = value;
        snapshotAt = Date.now();
      }
      return value;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function syncCacheGeneration() {
  return generation;
}
