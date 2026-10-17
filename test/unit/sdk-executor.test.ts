import { createHash } from 'node:crypto';
import { SDK_CATALOG_HASH } from '../../src/api/sdk-capabilities.generated';
import { describe, expect, it, vi } from 'vitest';
import { Card, PluginRem } from '@remnote/plugin-sdk';
import { executeSdkCall, getSdkCapabilities } from '../../src/api/sdk-executor';
import { MockRemNotePlugin } from '../helpers/mocks';
import { SETTING_ACCEPT_REPLACE_OPERATION, SETTING_PAIRING_TOKEN } from '../../src/settings';

const allow = async () => {};
const readOnly = async (mode: string) => {
  if (mode !== 'read') throw new Error('write operations are disabled');
};

describe('SDK executor', () => {
  it('materializes native aliases as text values without Rem identities or methods', async () => {
    const plugin = new MockRemNotePlugin();
    const rem = plugin.addTestRem('r', 'Title');
    const alias = Object.assign(Object.create(PluginRem.prototype), { text: ['Alias'] });
    vi.spyOn(rem, 'getAliases').mockResolvedValue([alias]);
    vi.spyOn(rem, 'getOrCreateAliasWithText').mockResolvedValue(alias);
    for (const [capability, value] of [
      ['rem:getAliases', [{ text: ['Alias'] }]],
      ['rem:getOrCreateAliasWithText', { text: ['Alias'] }],
    ] as const) {
      await expect(
        executeSdkCall(plugin as never, allow, { capability, targetId: 'r', args: [['Alias']] })
      ).resolves.toEqual({ capability, value });
      expect(getSdkCapabilities().capabilities.find((c) => c.id === capability)).toMatchObject({
        materialize: 'aliasText',
      });
    }
    vi.spyOn(rem, 'getAliases').mockResolvedValueOnce([Object.create(PluginRem.prototype)]);
    await expect(
      executeSdkCall(plugin as never, allow, { capability: 'rem:getAliases', targetId: 'r' })
    ).rejects.toThrow('alias text');
  });

  it('rejects malformed official SDK objects with the originating capability', async () => {
    const plugin = new MockRemNotePlugin();
    for (const value of [Object.create(PluginRem.prototype), Object.create(Card.prototype)]) {
      plugin.rem.findOne.mockResolvedValueOnce(value as never);
      await expect(
        executeSdkCall(plugin as never, allow, {
          capability: 'namespace:rem.findOne',
          args: ['r'],
        })
      ).rejects.toThrow(/namespace:rem.findOne.*identity/);
    }
  });
  it('does not expose pairing secrets or allow SDK callers to enable destructive operations', async () => {
    const plugin = new MockRemNotePlugin();
    for (const [capability, args] of [
      ['namespace:settings.getSetting', [SETTING_PAIRING_TOKEN]],
      [
        'namespace:settings.registerBooleanSetting',
        [{ id: SETTING_ACCEPT_REPLACE_OPERATION, defaultValue: true }],
      ],
    ] as const) {
      await expect(
        executeSdkCall(plugin as never, allow, { capability, args: [...args] })
      ).rejects.toThrow('security settings');
    }
    expect(plugin.settings.getSetting).not.toHaveBeenCalled();
    expect(plugin.settings.registerBooleanSetting).not.toHaveBeenCalled();
  });
  it('allows reads with writes disabled and rechecks authorization after target lookup', async () => {
    const plugin = new MockRemNotePlugin();
    const rem = plugin.addTestRem('r', 'Title');
    const readAuthorize = vi.fn(readOnly);
    await expect(
      executeSdkCall(plugin as never, readAuthorize, {
        capability: 'namespace:rem.findOne',
        args: ['r'],
      })
    ).resolves.toMatchObject({ value: { $type: 'rem', id: 'r' } });
    expect(readAuthorize.mock.calls.map(([mode]) => mode)).toEqual(['read', 'read']);
    const write = vi.spyOn(rem, 'setText');
    const authorize = vi.fn(async (mode: string) => {
      expect(plugin.rem.findOne).toHaveBeenCalled();
      expect(mode).toBe('write');
      throw new Error('KB changed');
    });
    await expect(
      executeSdkCall(plugin as never, authorize, {
        capability: 'rem:setText',
        targetId: 'r',
        args: [['Changed']],
      })
    ).rejects.toThrow('KB changed');
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    const modes: string[] = [];
    await executeSdkCall(
      plugin as never,
      async (mode: string) => {
        modes.push(mode);
      },
      { capability: 'rem:setText', targetId: 'r', args: [['Changed']] }
    );
    expect(modes).toEqual(['write', 'read']);
    expect(write).toHaveBeenCalledOnce();
  });

  it('materializes rich text without retaining SDK builder objects', async () => {
    const plugin = new MockRemNotePlugin();
    await expect(
      executeSdkCall(plugin as never, readOnly, {
        capability: 'namespace:richText.rem',
        args: ['target'],
      })
    ).resolves.toMatchObject({ value: [{ i: 'q', _id: 'target' }] });
    expect(
      getSdkCapabilities().capabilities.find((c) => c.id === 'namespace:richText.rem')
    ).toMatchObject({
      materialize: 'richText',
      status: 'supported',
    });
  });

  it('rejects bounded or malformed input before SDK access', async () => {
    const plugin = new MockRemNotePlugin();
    for (const args of [Array(1001).fill('x'), ['x'.repeat(1_000_001)], [Infinity]]) {
      await expect(
        executeSdkCall(plugin as never, allow, {
          capability: 'namespace:rem.findOne',
          args,
        })
      ).rejects.toThrow();
    }
    expect(plugin.rem.findOne).not.toHaveBeenCalled();
  });
  it('binds catalog contents and execution to the live generated SHA256', async () => {
    const result = getSdkCapabilities();
    expect(result.sdkCatalogHash).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({ sdkVersion: result.sdkVersion, capabilities: result.capabilities })
        )
        .digest('hex')
    );
    const plugin = new MockRemNotePlugin();
    const lookup = vi.spyOn(plugin.rem, 'findOne');
    await expect(
      executeSdkCall(plugin as never, allow, {
        capability: 'rem:getChildrenRem',
        targetId: 'r',
        expectedCatalogHash: '0'.repeat(64),
      })
    ).rejects.toThrow('catalog hash');
    expect(lookup).not.toHaveBeenCalled();
  });
  it('rechecks expected catalog identity after awaited lookup and before invocation', async () => {
    const plugin = new MockRemNotePlugin();
    plugin.addTestRem('r', 'Title');
    const params = {
      capability: 'rem:getChildrenRem',
      targetId: 'r',
      expectedCatalogHash: SDK_CATALOG_HASH,
    };
    const rem = await plugin.rem.findOne('r');
    vi.spyOn(plugin.rem, 'findOne').mockImplementation(async () => {
      params.expectedCatalogHash = '0'.repeat(64);
      return rem;
    });
    await expect(executeSdkCall(plugin as never, allow, params)).rejects.toThrow('catalog hash');
  });

  it('keeps the generated SDK 0.0.46 registry complete and current', () => {
    const result = getSdkCapabilities();

    expect(result.sdkVersion).toBe('0.0.46');
    expect(result.capabilities).toHaveLength(286);
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'namespace:powerup.getPowerupSlotByCode' }),
        expect.objectContaining({
          id: 'rem:getChildrenRem',
          group: 'rem',
          command: 'object-get-children-rem',
          signatures: expect.arrayContaining([expect.stringContaining('getChildrenRem')]),
          status: 'supported',
        }),
        expect.objectContaining({ id: 'card:getRem', status: 'supported' }),
        expect.objectContaining({
          id: 'card:updateCardRepetitionStatus',
          mode: 'destructive',
        }),
        expect.objectContaining({ id: 'query:text', status: 'supported' }),
        expect.objectContaining({
          id: 'namespace:focus.getFocusedRem',
          mode: 'interactive',
        }),
        expect.objectContaining({
          id: 'namespace:event.addListener',
          status: 'unsupported',
        }),
        expect.objectContaining({
          id: 'namespace:richText.builder.value',
          status: 'unsupported',
        }),
        expect.objectContaining({ id: 'namespace:plugin.track', status: 'unsupported' }),
      ])
    );
    expect(
      new Set(result.capabilities.map(({ group, command }) => `${group}:${command}`)).size
    ).toBe(result.capabilities.length);
  });

  it('requires the write gate for methods that can create daily documents', async () => {
    const plugin = new MockRemNotePlugin();

    await expect(
      executeSdkCall(plugin as never, readOnly, {
        capability: 'namespace:date.getTodaysDoc',
      })
    ).rejects.toThrow('write operations are disabled');
  });

  it('rejects unsupported and unregistered methods', async () => {
    const plugin = new MockRemNotePlugin();

    await expect(
      executeSdkCall(plugin as never, allow, {
        capability: 'namespace:event.addListener',
      })
    ).rejects.toThrow('Unsupported SDK capability');
    await expect(
      executeSdkCall(plugin as never, allow, { capability: 'namespace:kb.call' })
    ).rejects.toThrow('Unknown SDK capability');
    await expect(
      executeSdkCall(plugin as never, allow, { capability: 'namespace:rem.__proto__' })
    ).rejects.toThrow('Unknown SDK capability');
  });

  it('requires explicit destructive approval', async () => {
    const plugin = new MockRemNotePlugin();
    plugin.addTestRem('remove-me', 'Remove me');

    await expect(
      executeSdkCall(plugin as never, allow, {
        capability: 'rem:remove',
        targetId: 'remove-me',
      })
    ).rejects.toThrow('requires allowDestructive=true');

    await expect(
      executeSdkCall(plugin as never, allow, {
        capability: 'rem:remove',
        targetId: 'remove-me',
        allowDestructive: true,
      })
    ).resolves.toEqual({
      capability: 'rem:remove',
      value: { $type: 'undefined' },
    });
  });

  it('resolves Date and Rem references recursively', async () => {
    const plugin = new MockRemNotePlugin();
    const referencedRem = plugin.addTestRem('referenced-rem', 'Referenced');
    const dateResult = await executeSdkCall(plugin as never, allow, {
      capability: 'namespace:date.getDailyDoc',
      args: [{ $type: 'date', value: '2026-09-18T00:00:00.000Z' }],
    });

    expect(plugin.date.getDailyDoc).toHaveBeenCalledWith(new Date('2026-09-18T00:00:00.000Z'));
    expect(dateResult).toMatchObject({
      capability: 'namespace:date.getDailyDoc',
      value: { $type: 'rem', id: 'daily_doc', text: ['Daily Document'] },
    });

    await executeSdkCall(plugin as never, allow, {
      capability: 'namespace:messaging.broadcast',
      args: [{ nested: { $ref: 'rem', id: 'referenced-rem' } }],
    });
    expect(plugin.getBroadcastMessages()).toEqual([{ nested: referencedRem }]);
  });

  it('rejects functions, cycles, and unknown output classes', async () => {
    const plugin = new MockRemNotePlugin();
    plugin.app = {
      ...plugin.app,
      toast: vi.fn(async () => () => undefined),
    } as never;

    await expect(
      executeSdkCall(plugin as never, allow, {
        capability: 'namespace:app.toast',
        args: ['hello'],
      })
    ).rejects.toThrow('unsupported function');

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(
      executeSdkCall(plugin as never, allow, {
        capability: 'namespace:messaging.broadcast',
        args: [cyclic],
      })
    ).rejects.toThrow('circular reference');

    class UnknownSdkClass {}
    plugin.search.search.mockResolvedValueOnce([new UnknownSdkClass()] as never);
    await expect(
      executeSdkCall(plugin as never, allow, {
        capability: 'namespace:search.search',
        args: [['query']],
      })
    ).rejects.toThrow('unsupported class UnknownSdkClass');
  });
});
