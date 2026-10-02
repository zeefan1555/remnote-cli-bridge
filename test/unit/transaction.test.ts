import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransactionScope } from '../../src/bridge/transaction';

afterEach(() => vi.useRealTimers());
describe('native transaction scope', () => {
  it('waits for native commit and propagates failures', async () => {
    let committed = false;
    const app = {
      transaction: vi.fn(async (fn: () => Promise<void>) => {
        await fn();
        committed = true;
      }),
    };
    const scope = new TransactionScope({ app } as never);
    await scope.begin();
    expect(committed).toBe(false);
    await expect(scope.begin()).rejects.toThrow('already active');
    await scope.end(true);
    expect(committed).toBe(true);
    await expect(scope.end(true)).rejects.toThrow('not active');
    const rejected = new TransactionScope({
      app: {
        transaction: async () => {
          throw new Error('native failure');
        },
      },
    } as never);
    await expect(rejected.begin()).rejects.toThrow('native failure');
  });

  it('aborts on disconnect or deadline and cannot commit an expired scope', async () => {
    vi.useFakeTimers();
    const aborts = vi.fn();
    const app = {
      transaction: async (fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (e) {
          aborts();
          throw e;
        }
      },
    };
    const scope = new TransactionScope({ app } as never);
    await scope.begin();
    scope.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(aborts).toHaveBeenCalledOnce();
    await scope.begin();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(aborts).toHaveBeenCalledTimes(2);
    expect(() => scope.assertUsable()).toThrow('deadline');
    await expect(scope.end(true)).rejects.toThrow('expired');
  });

  it('acknowledges explicit abort without swallowing a failed commit', async () => {
    const app = {
      transaction: async (fn: () => Promise<void>) => {
        await fn();
        throw new Error('commit failed');
      },
    };
    const scope = new TransactionScope({ app } as never);
    await scope.begin();
    await scope.end(false);
    await scope.begin();
    await expect(scope.end(true)).rejects.toThrow('commit failed');
  });

  it('waits for native abort teardown before closing a session', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const scope = new TransactionScope({
      app: {
        transaction: async (fn: () => Promise<void>) => {
          try {
            await fn();
          } finally {
            await pending;
          }
        },
      },
    } as never);
    await scope.begin();
    let closed = false;
    const closing = scope.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish();
    await closing;
    expect(closed).toBe(true);
    expect(() => scope.assertUsable()).toThrow('deadline');
  });
});
