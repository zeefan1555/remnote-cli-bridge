import { declareIndexPlugin, type ReactRNPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import '../style.css';
import { initializeBridgeRuntime, shutdownBridgeRuntime } from '../bridge/runtime';
import {
  SETTING_ACCEPT_WRITE_OPERATIONS,
  SETTING_ACCEPT_REPLACE_OPERATION,
  SETTING_PAIRING_TOKEN,
  SETTING_WS_URL,
  DEFAULT_WS_URL,
} from '../settings';

export async function activateAutomationBridge(plugin: ReactRNPlugin) {
  await plugin.settings.registerBooleanSetting({
    id: SETTING_ACCEPT_WRITE_OPERATIONS,
    title: 'Accept write operations',
    description: 'Allow authenticated CLI writes to this knowledge base',
    defaultValue: false,
  });
  await plugin.settings.registerBooleanSetting({
    id: SETTING_ACCEPT_REPLACE_OPERATION,
    title: 'Accept destructive operations',
    description: 'Also require explicit authorization in the CLI command',
    defaultValue: false,
  });
  await plugin.settings.registerStringSetting({
    id: SETTING_PAIRING_TOKEN,
    title: 'CLI pairing token',
    description: 'Private token from remnote-cli pair',
    defaultValue: '',
  });
  await plugin.settings.registerStringSetting({
    id: SETTING_WS_URL,
    title: 'CLI loopback WebSocket URL',
    description: 'Reload the plugin after changing this URL',
    defaultValue: DEFAULT_WS_URL,
  });
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
