import { describe, expect, it } from 'vitest';
import { AUTOMATION_BRIDGE_LOG_PREFIX, withLogPrefix } from '../../src/logging';

describe('logging helpers', () => {
  it('uses the automation-bridge prefix constant', () => {
    expect(AUTOMATION_BRIDGE_LOG_PREFIX.toLowerCase()).toContain('automation-bridge');
  });

  it('prepends the shared prefix to messages', () => {
    const message = withLogPrefix('Plugin activating...');

    expect(message.toLowerCase()).toContain('automation-bridge');
    expect(message.endsWith('Plugin activating...')).toBe(true);
  });
});
