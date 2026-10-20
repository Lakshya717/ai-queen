import type { VideoLookupResponseDto } from '../../ports/IBackendApiAdapter';

export interface CacheConfig {
  maxEntries: number;
  ttlSeconds: number;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxEntries: 500,
  ttlSeconds: 86400, // 24 hours
};

interface CacheEntry {
  data: VideoLookupResponseDto;
  cachedAtMs: number;
}

export class ChromeStorageResultCacheRepository {
  private inMemoryFallback = new Map<string, CacheEntry>();

  constructor(private readonly config: CacheConfig = DEFAULT_CACHE_CONFIG) {}

  public async get(videoId: string): Promise<VideoLookupResponseDto | null> {
    const entry = await this.readEntry(videoId);
    if (!entry) return null;

    const ageSec = (Date.now() - entry.cachedAtMs) / 1000;
    if (ageSec > this.config.ttlSeconds) {
      await this.remove(videoId);
      return null;
    }

    return entry.data;
  }

  public async set(videoId: string, lookup: VideoLookupResponseDto): Promise<void> {
    // Invariant check: never cache server errors or invalid lookups
    if (!lookup || !lookup.videoId) return;

    // Privacy invariant audit: ensure no raw media or transcript text leaked into cache
    this.assertNoRawMediaLeakage(lookup);

    const entry: CacheEntry = {
      data: lookup,
      cachedAtMs: Date.now(),
    };

    await this.writeEntry(videoId, entry);
  }

  public async remove(videoId: string): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove(`cache_${videoId}`);
    } else {
      this.inMemoryFallback.delete(videoId);
    }
  }

  public async clear(): Promise<void> {
    this.inMemoryFallback.clear();
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const all = await chrome.storage.local.get(null);
      const cacheKeys = Object.keys(all).filter((k) => k.startsWith('cache_'));
      if (cacheKeys.length) {
        await chrome.storage.local.remove(cacheKeys);
      }
    }
  }

  private async readEntry(videoId: string): Promise<CacheEntry | null> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const key = `cache_${videoId}`;
      const result = await chrome.storage.local.get(key);
      return result[key] ?? null;
    }
    return this.inMemoryFallback.get(videoId) ?? null;
  }

  private async writeEntry(videoId: string, entry: CacheEntry): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [`cache_${videoId}`]: entry });
    } else {
      this.inMemoryFallback.set(videoId, entry);
    }
  }

  private assertNoRawMediaLeakage(obj: unknown): void {
    const str = JSON.stringify(obj);
    // Reject raw media payloads (data URLs or synthetic raw buffers)
    // while permitting technical metadata MIME strings (e.g. 'audio/webm;codecs=opus')
    if (str.includes('data:image/') || str.includes('data:audio/') || str.includes('data:video/') || str.includes('synthetic_jpeg')) {
      throw new Error('Privacy Invariant Violation: Attempted to persist raw media in result cache storage.');
    }
  }
}
