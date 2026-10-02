import type { ReactRNPlugin } from '@remnote/plugin-sdk';

export const SETTING_ACCEPT_WRITE_OPERATIONS = 'automation-bridge-accept-write-operations';
export const SETTING_ACCEPT_REPLACE_OPERATION = 'automation-bridge-accept-replace-operation';
export const SETTING_PAIRING_TOKEN = 'automation-bridge-pairing-token';
export const SETTING_WS_URL = 'automation-bridge-ws-url';
export const DEFAULT_ACCEPT_WRITE_OPERATIONS = false;
export const DEFAULT_ACCEPT_REPLACE_OPERATION = false;
export const DEFAULT_WS_URL = 'ws://127.0.0.1:3002';

export interface AutomationBridgeSettings {
  acceptWriteOperations: boolean;
  acceptReplaceOperation: boolean;
  pairingToken: string;
  wsUrl: string;
}
export function getDefaultAutomationBridgeSettings(): AutomationBridgeSettings {
  return {
    acceptWriteOperations: false,
    acceptReplaceOperation: false,
    pairingToken: '',
    wsUrl: DEFAULT_WS_URL,
  };
}
export async function readAutomationBridgeSettings(
  plugin: Pick<ReactRNPlugin, 'settings'>
): Promise<AutomationBridgeSettings> {
  const [write, destructive, token, url] = await Promise.all([
    plugin.settings.getSetting<boolean>(SETTING_ACCEPT_WRITE_OPERATIONS),
    plugin.settings.getSetting<boolean>(SETTING_ACCEPT_REPLACE_OPERATION),
    plugin.settings.getSetting<string>(SETTING_PAIRING_TOKEN),
    plugin.settings.getSetting<string>(SETTING_WS_URL),
  ]);
  return {
    acceptWriteOperations: write === true,
    acceptReplaceOperation: destructive === true,
    pairingToken: typeof token === 'string' ? token.trim() : '',
    wsUrl: typeof url === 'string' && url.trim() ? url.trim() : DEFAULT_WS_URL,
  };
}
