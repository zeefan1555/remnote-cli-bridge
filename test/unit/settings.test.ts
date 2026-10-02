import { describe, expect, it } from 'vitest';
import { MockRemNotePlugin } from '../helpers/mocks';
import {
  getDefaultAutomationBridgeSettings,
  readAutomationBridgeSettings,
  SETTING_ACCEPT_WRITE_OPERATIONS,
  SETTING_ACCEPT_REPLACE_OPERATION,
  SETTING_PAIRING_TOKEN,
  SETTING_WS_URL,
} from '../../src/settings';

describe('gateway settings', () => {
  it('defaults to read-only and never coerces unsafe stored values', async () => {
    const plugin = new MockRemNotePlugin();
    expect(await readAutomationBridgeSettings(plugin as never)).toEqual(
      getDefaultAutomationBridgeSettings()
    );
    plugin.setTestSetting(SETTING_ACCEPT_WRITE_OPERATIONS, 'true');
    plugin.setTestSetting(SETTING_ACCEPT_REPLACE_OPERATION, 1);
    plugin.setTestSetting(SETTING_PAIRING_TOKEN, 123);
    plugin.setTestSetting(SETTING_WS_URL, ' ');
    expect(await readAutomationBridgeSettings(plugin as never)).toEqual(
      getDefaultAutomationBridgeSettings()
    );
    plugin.setTestSetting(SETTING_ACCEPT_WRITE_OPERATIONS, true);
    plugin.setTestSetting(SETTING_ACCEPT_REPLACE_OPERATION, true);
    plugin.setTestSetting(SETTING_PAIRING_TOKEN, ' token ');
    plugin.setTestSetting(SETTING_WS_URL, ' ws://127.0.0.1:5555 ');
    expect(await readAutomationBridgeSettings(plugin as never)).toEqual({
      acceptWriteOperations: true,
      acceptReplaceOperation: true,
      pairingToken: 'token',
      wsUrl: 'ws://127.0.0.1:5555',
    });
  });
});
