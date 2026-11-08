import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CACHE_KEY = 'forkop.sing-geosite.v1';
const DAY = 24 * 60 * 60 * 1000;
let stored: Map<string, string>;

function catalog(paths = ['geosite-youtube.srs']) {
  return {
    ok: true,
    json: async () => ({
      truncated: false,
      tree: paths.map((path) => ({ path, type: 'blob' })),
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
  stored = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sing-geosite catalog', () => {
  it('loads more than 1,000 SRS files including attribute variants, filtering other paths', async () => {
    const files = Array.from(
      { length: 1100 },
      (_, i) => `geosite-test${i}.srs`,
    );
    files.push('geosite-google@!cn.srs', 'geosite-google@cn.srs');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        catalog([...files, files[0], 'README.md', 'nested/geosite-test.srs']),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { loadSingGeositeFiles } = await import('../singGeo.service');

    expect(await loadSingGeositeFiles()).toEqual(files.sort());
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/SagerNet/sing-geosite/git/trees/rule-set',
    );
    expect(JSON.parse(stored.get(CACHE_KEY)!)).toEqual({
      timestamp: Date.now(),
      files,
    });
  });

  it('shares concurrent requests and reuses the persisted catalog after a page reload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(catalog());
    vi.stubGlobal('fetch', fetchMock);
    const { loadSingGeositeFiles } = await import('../singGeo.service');
    await Promise.all([loadSingGeositeFiles(), loadSingGeositeFiles()]);
    await loadSingGeositeFiles();
    vi.resetModules();
    const reloaded = await import('../singGeo.service');
    expect(await reloaded.loadSingGeositeFiles()).toEqual([
      'geosite-youtube.srs',
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refreshes an expired catalog', async () => {
    stored.set(
      CACHE_KEY,
      JSON.stringify({
        timestamp: Date.now() - DAY,
        files: ['geosite-old.srs'],
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue(catalog());
    vi.stubGlobal('fetch', fetchMock);
    const { loadSingGeositeFiles } = await import('../singGeo.service');
    expect(await loadSingGeositeFiles()).toEqual(['geosite-youtube.srs']);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(['network', 'rate limit', 'truncated', 'empty'])(
    'keeps expired data when the refresh fails: %s',
    async (failure) => {
      const old = JSON.stringify({
        timestamp: Date.now() - DAY,
        files: ['geosite-old.srs'],
      });
      stored.set(CACHE_KEY, old);
      const fetchMock = vi.fn();
      if (failure === 'network')
        fetchMock.mockRejectedValue(new Error('offline'));
      else if (failure === 'rate limit')
        fetchMock.mockResolvedValue({ ok: false, status: 403 });
      else if (failure === 'truncated')
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({ truncated: true, tree: [] }),
        });
      else fetchMock.mockResolvedValue(catalog([]));
      vi.stubGlobal('fetch', fetchMock);
      const { loadSingGeositeFiles } = await import('../singGeo.service');
      expect(await loadSingGeositeFiles()).toEqual(['geosite-old.srs']);
      expect(stored.get(CACHE_KEY)).toBe(old);
    },
  );

  it('ignores corrupt cache data and retries after a failed first request', async () => {
    stored.set(CACHE_KEY, '{broken');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(catalog());
    vi.stubGlobal('fetch', fetchMock);
    const { loadSingGeositeFiles } = await import('../singGeo.service');
    expect(await loadSingGeositeFiles()).toEqual([]);
    expect(await loadSingGeositeFiles()).toEqual(['geosite-youtube.srs']);
  });

  it('works when browser storage is blocked', async () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('blocked');
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(catalog());
    vi.stubGlobal('fetch', fetchMock);
    const { loadSingGeositeFiles } = await import('../singGeo.service');
    expect(await loadSingGeositeFiles()).toEqual(['geosite-youtube.srs']);
    expect(await loadSingGeositeFiles()).toEqual(['geosite-youtube.srs']);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts a stalled request so the rule dialog can still open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      ),
    );
    const { loadSingGeositeFiles } = await import('../singGeo.service');
    const result = loadSingGeositeFiles();
    await vi.advanceTimersByTimeAsync(8000);
    expect(await result).toEqual([]);
  });
});

describe('sing-geoip catalog alongside sing-geosite', () => {
  const GEOIP_CACHE_KEY = 'forkop.sing-geoip.v1';
  const GEOIP_CATALOG_URL =
    'https://api.github.com/repos/SagerNet/sing-geoip/git/trees/rule-set';

  it('keeps requests and caches separate and reuses both after a page reload', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === GEOIP_CATALOG_URL
        ? catalog([
            'geoip-ru.srs',
            'geoip-us.srs',
            'geoip-ru.srs',
            'geosite-youtube.srs',
            'README.md',
          ])
        : catalog(['geosite-youtube.srs', 'geoip-ru.srs']),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { loadSingGeositeFiles, loadSingGeoipFiles } = await import(
      '../singGeo.service'
    );
    const result = await Promise.all([
      loadSingGeositeFiles(),
      loadSingGeoipFiles(),
      loadSingGeoipFiles(),
    ]);
    expect(result).toEqual([
      ['geosite-youtube.srs'],
      ['geoip-ru.srs', 'geoip-us.srs'],
      ['geoip-ru.srs', 'geoip-us.srs'],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stored.get(GEOIP_CACHE_KEY)!).files).toEqual([
      'geoip-ru.srs',
      'geoip-us.srs',
    ]);
    expect(JSON.parse(stored.get(CACHE_KEY)!).files).toEqual([
      'geosite-youtube.srs',
    ]);
    vi.resetModules();
    const reloaded = await import('../singGeo.service');
    expect(await reloaded.loadSingGeoipFiles()).toEqual([
      'geoip-ru.srs',
      'geoip-us.srs',
    ]);
    expect(await reloaded.loadSingGeositeFiles()).toEqual([
      'geosite-youtube.srs',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps expired GeoIP data on failure and refreshes it without changing geosite', async () => {
    const geositeCache = JSON.stringify({
      timestamp: Date.now(),
      files: ['geosite-youtube.srs'],
    });
    stored.set(CACHE_KEY, geositeCache);
    stored.set(
      GEOIP_CACHE_KEY,
      JSON.stringify({ timestamp: Date.now() - DAY, files: ['geoip-ru.srs'] }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce(catalog(['geoip-ru.srs', 'geoip-us.srs']));
    vi.stubGlobal('fetch', fetchMock);
    const { loadSingGeoipFiles, loadSingGeositeFiles } = await import(
      '../singGeo.service'
    );
    expect(await loadSingGeoipFiles()).toEqual(['geoip-ru.srs']);
    expect(await loadSingGeositeFiles()).toEqual(['geosite-youtube.srs']);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(GEOIP_CATALOG_URL);
    expect(await loadSingGeoipFiles()).toEqual([
      'geoip-ru.srs',
      'geoip-us.srs',
    ]);
    expect(stored.get(CACHE_KEY)).toBe(geositeCache);
  });
});
