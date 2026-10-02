import type { ReactRNPlugin } from '@remnote/plugin-sdk';
import { TRANSACTION_TIMEOUT_MS } from './protocol';

/** One native transaction per authenticated socket, never a remote callback or object handle. */
export class TransactionScope {
  private expired = false;
  private completion: Promise<unknown> = Promise.resolve();
  private active?: {
    finish: (commit: boolean) => void;
    result: Promise<unknown>;
    timer: ReturnType<typeof setTimeout>;
  };

  constructor(private readonly plugin: Pick<ReactRNPlugin, 'app'>) {}

  async begin(): Promise<void> {
    this.assertUsable();
    if (this.active) throw new Error('Transaction already active');
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let finish!: (commit: boolean) => void;
    const outcome = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const result = this.plugin.app.transaction(async () => {
      ready();
      if (!(await outcome)) throw new Error('Transaction aborted');
    });
    // A timeout/disconnect must not produce an unhandled rejection while a call is in flight.
    this.completion = result.catch(() => {});
    this.active = {
      finish,
      result,
      timer: setTimeout(() => {
        this.expired = true;
        this.abort();
      }, TRANSACTION_TIMEOUT_MS),
    };
    try {
      await Promise.race([
        started,
        result.then(() => {
          throw new Error('Transaction did not start');
        }),
      ]);
    } catch (error) {
      this.abort();
      throw error;
    }
  }

  async end(commit: boolean): Promise<void> {
    const active = this.active;
    if (!active) throw new Error('Transaction expired or is not active; verify write outcome');
    this.active = undefined;
    clearTimeout(active.timer);
    active.finish(commit);
    if (commit) await active.result;
    else await active.result.catch(() => {});
  }

  abort(): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    clearTimeout(active.timer);
    active.finish(false);
  }

  async close(): Promise<void> {
    this.expired = true;
    this.abort();
    await this.completion;
  }

  assertUsable(): void {
    if (this.expired)
      throw new Error('Transaction deadline expired; start a new command and verify outcome');
  }
}
