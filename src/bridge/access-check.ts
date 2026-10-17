export const ACCESS_CHECK_TTL_MS = 100;

export interface AccessCheckCache<T> {
  get(): Promise<T>;
  invalidate(): void;
}

// Concurrent callers share one load. A success is reused for at most `ttlMs`.
// Failures are not cached. invalidate() drops a stored result and any load that
// has not been returned yet; callers already waiting on that load keep it.
export function createAccessCheckCache<T>(
  load: () => Promise<T>,
  ttlMs = ACCESS_CHECK_TTL_MS
): AccessCheckCache<T> {
  let inFlight: Promise<T> | null = null;
  let cached: { at: number; value: T } | null = null;
  let generation = 0;

  return {
    invalidate() {
      generation += 1;
      cached = null;
      inFlight = null;
    },
    get() {
      if (cached && Date.now() - cached.at < ttlMs) return Promise.resolve(cached.value);
      if (inFlight) return inFlight;
      const generationAtStart = generation;
      const pending = load()
        .then((value) => {
          if (generation === generationAtStart) cached = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          if (inFlight === pending) inFlight = null;
        });
      inFlight = pending;
      return pending;
    },
  };
}
