import { describe, expect, it } from 'vitest';
import type { PlatformHandle, PlatformId } from '../engram/types.js';
import { type ChannelEvent, createMockChannel } from './mock.js';

const ALL_PLATFORMS: readonly PlatformId[] = [
  'imessage',
  'whatsapp',
  'telegram',
  'slack',
  'discord',
];

describe('createMockChannel', () => {
  it('exposes the five platforms by default', () => {
    const channel = createMockChannel();
    expect([...channel.platforms]).toEqual([...ALL_PLATFORMS]);
  });

  it('records platform + handle correctly across all 5 platforms on send', async () => {
    const channel = createMockChannel();
    const pairs: Array<{ handle: PlatformHandle; text: string }> = [
      { handle: { platform: 'imessage', handle: '+81-111' }, text: 'im-hi' },
      { handle: { platform: 'whatsapp', handle: '+1-222' }, text: 'wa-hi' },
      { handle: { platform: 'telegram', handle: '333' }, text: 'tg-hi' },
      { handle: { platform: 'slack', handle: 'U123' }, text: 'sl-hi' },
      { handle: { platform: 'discord', handle: 'user#4' }, text: 'dc-hi' },
    ];

    for (const p of pairs) {
      await channel.send(p.handle, { text: p.text, kind: 'notice' });
    }

    expect(channel.sent).toHaveLength(5);
    for (const [i, pair] of pairs.entries()) {
      const record = channel.sent[i];
      if (!record) throw new Error(`missing record at index ${i}`);
      expect(record.platform).toBe(pair.handle.platform);
      expect(record.handle).toBe(pair.handle.handle);
      expect(record.text).toBe(pair.text);
      expect(record.kind).toBe('notice');
      expect(record.at).toBeInstanceOf(Date);
    }
  });

  it('simulateReceive invokes registered onReceive handler with the right from/text', async () => {
    const channel = createMockChannel();
    const received: Array<{ from: PlatformHandle; text: string }> = [];
    channel.onReceive(async (from, text) => {
      received.push({ from, text });
    });

    await channel.simulateReceive({ platform: 'telegram', handle: '12345' }, 'hello there');

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      from: { platform: 'telegram', handle: '12345' },
      text: 'hello there',
    });
  });

  it('subscribe receives channel:sent events in order, unsubscribe stops delivery', async () => {
    const channel = createMockChannel();
    const events: ChannelEvent[] = [];
    const unsubscribe = channel.subscribe((e) => events.push(e));

    await channel.send({ platform: 'imessage', handle: 'a' }, { text: 'one' });
    await channel.send({ platform: 'whatsapp', handle: 'b' }, { text: 'two' });

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('channel:sent');
    expect(events[0]).toMatchObject({
      type: 'channel:sent',
      platform: 'imessage',
      handle: 'a',
      text: 'one',
    });
    expect(events[1]).toMatchObject({
      type: 'channel:sent',
      platform: 'whatsapp',
      handle: 'b',
      text: 'two',
    });

    unsubscribe();
    await channel.send({ platform: 'slack', handle: 'c' }, { text: 'three' });
    expect(events).toHaveLength(2);
  });

  it('subscribe receives channel:received events from simulateReceive', async () => {
    const channel = createMockChannel();
    const events: ChannelEvent[] = [];
    channel.subscribe((e) => events.push(e));

    await channel.simulateReceive({ platform: 'discord', handle: 'u#9' }, 'ping');

    const received = events.find((e) => e.type === 'channel:received');
    expect(received).toMatchObject({
      type: 'channel:received',
      platform: 'discord',
      handle: 'u#9',
      text: 'ping',
    });
  });

  it('setOnline emits platform-status events', () => {
    const channel = createMockChannel();
    const events: ChannelEvent[] = [];
    channel.subscribe((e) => events.push(e));

    channel.setOnline('telegram', true);
    channel.setOnline('telegram', false);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'channel:platform-status',
      platform: 'telegram',
      online: true,
    });
    expect(events[1]).toMatchObject({
      type: 'channel:platform-status',
      platform: 'telegram',
      online: false,
    });
  });

  it('clear resets sent records', async () => {
    const channel = createMockChannel();
    await channel.send({ platform: 'imessage', handle: 'x' }, { text: 'a' });
    expect(channel.sent).toHaveLength(1);
    channel.clear();
    expect(channel.sent).toHaveLength(0);
  });
});
