import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_CHECK_TTL_MS, createAccessCheckCache } from '../../src/bridge/access-check';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('access check cache', () => {
  it('shares one in-flight load, expires after 100ms, and drops the cache on invalidate', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const resolvers: Array<(value: string) => void> = [];
    let calls = 0;
    const cache = createAccessCheckCache(
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          resolvers.push(resolve);
        })
    );

    const first = cache.get();
    const second = cache.get();
    expect(second).toBe(first);
    expect(calls).toBe(1);
    resolvers[0]('shared');
    await expect(first).resolves.toBe('shared');
    await expect(second).resolves.toBe('shared');
    expect(await cache.get()).toBe('shared');
    expect(calls).toBe(1);

    now += ACCESS_CHECK_TTL_MS - 1;
    expect(await cache.get()).toBe('shared');
    expect(calls).toBe(1);
    now += 1;
    const expired = cache.get();
    expect(calls).toBe(2);
    resolvers[1]('fresh');
    await expect(expired).resolves.toBe('fresh');

    cache.invalidate();
    const invalidated = cache.get();
    expect(calls).toBe(3);
    resolvers[2]('reset');
    await expect(invalidated).resolves.toBe('reset');
    expect(await cache.get()).toBe('reset');
    expect(calls).toBe(3);
  });

  it('does not cache a failure or let a superseded load replace a newer result', async () => {
    const resolvers: Array<(value: string) => void> = [];
    let calls = 0;
    const cache = createAccessCheckCache(
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          resolvers.push(resolve);
        })
    );
    const stale = cache.get();
    cache.invalidate();
    const fresh = cache.get();
    expect(calls).toBe(2);
    resolvers[1]('fresh');
    await expect(fresh).resolves.toBe('fresh');
    resolvers[0]('stale');
    await expect(stale).resolves.toBe('stale');
    expect(await cache.get()).toBe('fresh');
    expect(calls).toBe(2);

    const failing = createAccessCheckCache(async () => {
      throw new Error('denied');
    });
    await expect(failing.get()).rejects.toThrow('denied');
    await expect(failing.get()).rejects.toThrow('denied');
  });
});
