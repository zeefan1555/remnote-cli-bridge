import { ReactRNPlugin } from '@remnote/plugin-sdk';
import { expect, it, vi } from 'vitest';

it('documents the installed SDK callback failure without contacting RemNote', async () => {
  const send = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  const plugin = new ReactRNPlugin(
    () => {},
    () => {}
  );
  const receive = (data: Record<string, unknown>) =>
    plugin._receive(
      new MessageEvent('message', { data: { ...data, isIntendedForRemNoteAPIPlugin: true } })
    );

  for (const reject of [false, true]) {
    send.mockClear();
    const transaction = plugin.app.transaction(async () => {
      if (reject) throw new Error('offline callback failure');
      return 42;
    });
    const request = send.mock.calls[0][0];
    expect(request.methodName).toBe('transaction');
    const callback = receive({
      callbackId: request.args.id,
      callbackReturnValueHandlerId: 'offline-result',
      args: {},
    });
    if (reject) await expect(callback).rejects.toThrow('offline callback failure');
    else await callback;

    const response = send.mock.calls.find(
      ([data]) => data.methodName === 'callback.handleCallbackResponse'
    )?.[0];
    expect(Boolean(response)).toBe(!reject);
    if (response) await receive({ messageId: response.messageId, response: undefined });

    // Settle only the simulated host request; a real failed callback never sends this response.
    await receive({ messageId: request.messageId, response: 42 });
    await expect(transaction).resolves.toBe(42);
  }
});
