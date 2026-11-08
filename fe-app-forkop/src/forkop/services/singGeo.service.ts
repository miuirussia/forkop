import { getLocalStorage } from './browserStorage.service';

export const SING_GEOSITE_URL =
  'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/';
export const SING_GEOIP_URL =
  'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/';
const CACHE_TTL = 24 * 60 * 60 * 1000;

interface CatalogCache {
  timestamp: number;
  files: string[];
}

function createCatalogLoader(kind: 'geosite' | 'geoip') {
  const catalogUrl = `https://api.github.com/repos/SagerNet/sing-${kind}/git/trees/rule-set`;
  const cacheKey = `forkop.sing-${kind}.v1`;
  const filePattern = new RegExp(`^${kind}-[a-z0-9@!._+-]+\\.srs$`, 'u');
  let cache: CatalogCache | null = null;
  let pending: Promise<string[]> | null = null;

  function isRulesetFile(value: unknown): value is string {
    return typeof value === 'string' && filePattern.test(value);
  }

  function readCache(): CatalogCache | null {
    try {
      const stored = JSON.parse(getLocalStorage()?.getItem(cacheKey) ?? 'null');
      if (
        stored &&
        Number.isFinite(stored.timestamp) &&
        Array.isArray(stored.files) &&
        stored.files.length > 0 &&
        stored.files.every(isRulesetFile)
      ) {
        return stored;
      }
    } catch {
      // Site data can be unavailable or left by an interrupted write.
    }
    return null;
  }

  // The Git tree endpoint includes the whole catalog; the contents endpoint stops at 1,000 files.
  return function loadFiles(): Promise<string[]> {
    cache ??= readCache();
    const age = cache ? Date.now() - cache.timestamp : -1;
    if (cache && age >= 0 && age < CACHE_TTL) {
      return Promise.resolve(cache.files);
    }
    if (pending) return pending;

    pending = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(catalogUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
        const data = await response.json();
        if (data.truncated !== false || !Array.isArray(data.tree)) {
          throw new Error(`Incomplete sing-${kind} catalog`);
        }
        const files: string[] = Array.from(
          new Set<string>(
            data.tree
              .filter(
                (entry: { type?: unknown; path?: unknown } | null) =>
                  entry?.type === 'blob' && isRulesetFile(entry.path),
              )
              .map((entry: { path: string }) => entry.path),
          ),
        ).sort();
        if (!files.length) throw new Error(`Empty sing-${kind} catalog`);
        cache = { timestamp: Date.now(), files };
        try {
          getLocalStorage()?.setItem(cacheKey, JSON.stringify(cache));
        } catch {
          // Keep the in-memory catalog when storage is blocked or full.
        }
        return files;
      } catch {
        return cache?.files ?? [];
      } finally {
        clearTimeout(timeout);
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
}

export const loadSingGeositeFiles = createCatalogLoader('geosite');
export const loadSingGeoipFiles = createCatalogLoader('geoip');
