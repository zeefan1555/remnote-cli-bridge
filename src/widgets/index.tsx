import { declareIndexPlugin, type ReactRNPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import '../style.css';
import { initializeBridgeRuntime, shutdownBridgeRuntime } from '../bridge/runtime';

export async function activateAutomationBridge(plugin: ReactRNPlugin) {
  await initializeBridgeRuntime(plugin);
  await plugin.app.registerWidget('sdk_bridge', WidgetLocation.RightSidebar, {
    widgetTabIcon: plugin.rootURL + 'sdk-icon.svg',
  });
}
export async function deactivateAutomationBridge(plugin: ReactRNPlugin) {
  shutdownBridgeRuntime();
  await plugin.app.unregisterWidget('sdk_bridge', WidgetLocation.RightSidebar);
}
declareIndexPlugin(activateAutomationBridge, deactivateAutomationBridge);
