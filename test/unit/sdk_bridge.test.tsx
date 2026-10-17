import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ plugin: null as unknown, renderWidget: vi.fn() }));
vi.mock('@remnote/plugin-sdk', () => ({
  StorageEvents: { StorageSessionChange: 'storage.session.changed' },
  renderWidget: sdk.renderWidget,
  usePlugin: () => sdk.plugin,
}));
import { AutomationBridgeWidget } from '../../src/widgets/sdk_bridge';
import { BRIDGE_UI_SNAPSHOT_STORAGE_KEY } from '../../src/widgets/runtime-ui-bridge';

describe('connection sidebar', () => {
  it('shows live state, accepts reconnect and cleans up without exposing business content', async () => {
    let listener: (value: unknown) => void = () => {};
    const plugin = {
      event: {
        addListener: vi.fn((_, __, fn) => {
          listener = fn;
        }),
        removeListener: vi.fn(),
      },
      storage: { getSession: vi.fn(async () => undefined), setSession: vi.fn(async () => {}) },
    };
    sdk.plugin = plugin;
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      await act(async () => {
        ReactDOM.render(<AutomationBridgeWidget />, container);
      });
      expect(container.textContent).toContain('Waiting for CLI');
      expect(plugin.event.addListener).toHaveBeenCalledWith(
        'storage.session.changed',
        BRIDGE_UI_SNAPSHOT_STORAGE_KEY,
        expect.any(Function)
      );
      await act(async () => {
        listener({
          status: 'connected',
          retryPhase: 'idle',
          bridgeVersion: 'test',
          pluginId: 'remnote-cli-bridge',
          protocolVersion: 1,
          sdkVersion: '0.0.46',
          knowledgeBaseId: 'test-kb',
          knowledgeBaseName: 'Test KB',
          authorizationError: 'Read denied',
          wsUrl: 'ws://127.0.0.1:3002',
          requestCount: 5,
          logs: [
            { timestamp: 1, message: 'Failure', level: 'error' },
            { timestamp: 2, message: 'Retry', level: 'info' },
          ],
        });
      });
      expect(container.textContent).toContain('CLI connected');
      expect(container.textContent).toContain('RemNote CLI Bridge');
      expect(container.textContent).toContain('remnote-cli-bridge');
      expect(container.textContent).toContain('1 / 0.0.46');
      expect(container.textContent).toContain('Test KB (test-kb)');
      expect(container.querySelector('[role="alert"]')?.textContent).toBe('Read denied');
      expect(container.textContent).toContain('Failure');
      await act(async () => {
        container.querySelector('button')!.click();
      });
      expect(plugin.storage.setSession).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: 'reconnect' })
      );
    } finally {
      act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
      container.remove();
    }
    expect(plugin.event.removeListener).toHaveBeenCalled();
  });
});
