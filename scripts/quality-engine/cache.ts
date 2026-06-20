import { getRedisValue, setRedisValue, incrementRedisValue, deleteRedisKey, setRedisExpiration } from "../../web/lib/redis";
import type { SourceFile } from "ts-morph";

interface CacheItem<T> {
  value: T;
  expiresAt: number;
}

class InMemoryCache {
  private store = new Map<string, CacheItem<any>>();
  get<T>(key: string): T | undefined {
    const item = this.store.get(key);
    if (!item) return undefined;
    if (item.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return item.value;
  }
  set<T>(key: string, value: T, ttlSeconds = 3600) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  del(key: string) {
    this.store.delete(key);
  }
}

class RedisCache extends InMemoryCache {
  private ready = false;
  constructor() {
    super();
    this.init();
  }
  async init() {
    // lazy init handled via web/lib/redis.ts when imported
    this.ready = true;
  }
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await getRedisValue(key);
      if (raw === undefined) return undefined;
      return JSON.parse(raw);
    } catch (e) {
      console.debug("[RedisCache] get error", e);
      return undefined;
    }
  }
  async set<T>(key: string, value: T, ttlSeconds = 3600) {
    try {
      const raw = JSON.stringify(value);
      await setRedisValue(key, raw, ttlSeconds);
    } catch (e) {
      console.debug("[RedisCache] set error", e);
    }
  }
  async del(key: string) {
    try {
      await deleteRedisKey(key);
    } catch (e) {
      console.debug("[RedisCache] del error", e);
    }
  }
}

export function createCache(useRedis: boolean) {
  return useRedis ? new RedisCache() : new InMemoryCache();
}

export type QaIntelCache = InMemoryCache | RedisCache;