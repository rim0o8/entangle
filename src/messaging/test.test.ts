import { describe, expect, it } from 'vitest';
import type { PlatformHandle, PlatformId } from '../engram/types.js';
import { type MessengerEvent, createTestMessenger } from './test.js';

const ALL_PLATFORMS: readonly PlatformId[] = ['imessage'];

describe('createTestMessenger', () => {
  it('exposes only iMessage by default', () => {
    const messenger = createTestMessenger();
    expect([...messenger.platforms]).toEqual([...ALL_PLATFORMS]);
  });

  it('records platform + handle correctly on send', async () => {
    const messenger = createTestMessenger();
    const pairs: Array<{ handle: PlatformHandle; text: string }> = [
      { handle: { platform: 'imessage', handle: '+81-111' }, text: 'im-hi-1' },
      { handle: { platform: 'imessage', handle: '+1-222' }, text: 'im-hi-2' },
    ];

    for (const p of pairs) {
      await messenger.send(p.handle, { text: p.text, kind: 'notice' });
    }

    expect(messenger.sent).toHaveLength(2);
    for (const [i, pair] of pairs.entries()) {
      const record = messenger.sent[i];
      if (!record) throw new Error(`missing record at index ${i}`);
      expect(record.platform).toBe(pair.handle.platform);
      expect(record.handle).toBe(pair.handle.handle);
      expect(record.text).toBe(pair.text);
      expect(record.kind).toBe('notice');
      expect(record.at).toBeInstanceOf(Date);
    }
  });

  it('simulateReceive invokes registered onReceive handler with the right from/text', async () => {
    const messenger = createTestMessenger();
    const received: Array<{ from: PlatformHandle; text: string }> = [];
    messenger.onReceive(async (from, text) => {
      received.push({ from, text });
    });

    await messenger.simulateReceive({ platform: 'imessage', handle: '+81-12345' }, 'hello there');

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      from: { platform: 'imessage', handle: '+81-12345' },
      text: 'hello there',
    });
  });

  it('subscribe receives messenger:sent events in order, unsubscribe stops delivery', async () => {
    const messenger = createTestMessenger();
    const events: MessengerEvent[] = [];
    const unsubscribe = messenger.subscribe((e) => events.push(e));

    await messenger.send({ platform: 'imessage', handle: 'a' }, { text: 'one' });
    await messenger.send({ platform: 'imessage', handle: 'b' }, { text: 'two' });

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('messenger:sent');
    expect(events[0]).toMatchObject({
      type: 'messenger:sent',
      platform: 'imessage',
      handle: 'a',
      text: 'one',
    });
    expect(events[1]).toMatchObject({
      type: 'messenger:sent',
      platform: 'imessage',
      handle: 'b',
      text: 'two',
    });

    unsubscribe();
    await messenger.send({ platform: 'imessage', handle: 'c' }, { text: 'three' });
    expect(events).toHaveLength(2);
  });

  it('subscribe receives messenger:received events from simulateReceive', async () => {
    const messenger = createTestMessenger();
    const events: MessengerEvent[] = [];
    messenger.subscribe((e) => events.push(e));

    await messenger.simulateReceive({ platform: 'imessage', handle: '+1-9' }, 'ping');

    const received = events.find((e) => e.type === 'messenger:received');
    expect(received).toMatchObject({
      type: 'messenger:received',
      platform: 'imessage',
      handle: '+1-9',
      text: 'ping',
    });
  });

  it('setOnline emits platform-status events', () => {
    const messenger = createTestMessenger();
    const events: MessengerEvent[] = [];
    messenger.subscribe((e) => events.push(e));

    messenger.setOnline('imessage', true);
    messenger.setOnline('imessage', false);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'messenger:platform-status',
      platform: 'imessage',
      online: true,
    });
    expect(events[1]).toMatchObject({
      type: 'messenger:platform-status',
      platform: 'imessage',
      online: false,
    });
  });

  it('clear resets sent records', async () => {
    const messenger = createTestMessenger();
    await messenger.send({ platform: 'imessage', handle: 'x' }, { text: 'a' });
    expect(messenger.sent).toHaveLength(1);
    messenger.clear();
    expect(messenger.sent).toHaveLength(0);
  });
});
