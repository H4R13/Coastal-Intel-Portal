/**
 * Connections for the data API: PostgreSQL holds the layer data, Redis keeps answers that were already worked out.
 * Settings come from .env (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, REDIS_URL).
 */
import pg from "pg";
import Redis from "ioredis";

export const pool = new pg.Pool({ max: 8 });
pool.on("error", (e) => console.warn(`PostgreSQL: ${e.message}`));
export const query = (text, params) => pool.query(text, params);

// The cache is optional: if Redis is down, commands fail fast and every request is answered from the database.
export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: (n) => Math.min(n * 500, 10000),
});
redis.on("error", () => {});

export const PREFIX = "pakcoast:";

/** Return the cached Buffer for `key`, or run `load()` (which must return a Buffer), store it and return it. */
export async function cached(key, load) {
  try {
    const hit = await redis.getBuffer(PREFIX + key);
    if (hit) return { body: hit, cache: "hit" };
  } catch { /* cache unavailable */ }
  const body = await load();
  redis.set(PREFIX + key, body).catch(() => {});
  return { body, cache: "miss" };
}

/** Forget everything cached for one layer; called by the loaders after new data goes in. */
export async function clearCache(layer) {
  let n = 0;
  for await (const keys of redis.scanStream({ match: `${PREFIX}${layer}:*`, count: 500 })) {
    if (keys.length) n += await redis.del(...keys);
  }
  return n;
}
