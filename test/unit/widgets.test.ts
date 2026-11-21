import { describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  initializeBridgeRuntime: vi.fn(),
  shutdownBridgeRuntime: vi.fn(),
}));
vi.mock('../../src/bridge/runtime', () => runtime);
vi.mock('@remnote/plugin-sdk', () => ({
  declareIndexPlugin: vi.fn(),
  WidgetLocation: { RightSidebar: 3 },
}));
import { activateAutomationBridge, deactivateAutomationBridge } from '../../src/widgets/index';

describe('plugin activation', () => {
  it('registers no custom settings and owns runtime and sidebar lifecycle', async () => {
    const plugin = {
      rootURL: 'http://localhost:8090/',
      app: { registerWidget: vi.fn(), unregisterWidget: vi.fn() },
    };
    await activateAutomationBridge(plugin as never);
    expect(runtime.initializeBridgeRuntime).toHaveBeenCalledWith(plugin);
    expect(plugin.app.registerWidget).toHaveBeenCalledWith('sdk_bridge', 3, {
      widgetTabIcon: plugin.rootURL + 'sdk-icon.svg',
    });
    await deactivateAutomationBridge(plugin as never);
    expect(runtime.shutdownBridgeRuntime).toHaveBeenCalledOnce();
    expect(plugin.app.unregisterWidget).toHaveBeenCalledWith('sdk_bridge', 3);
  });
});
