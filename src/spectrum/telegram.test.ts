import { describe, expect, it, vi } from 'vitest';
import type { IdentityGraph, Person, PlatformHandle } from '../engram/types.js';
import { type TelegramBotLike, createTelegramChannel } from './telegram.js';

function createFakeBot() {
  const sendMessage = vi.fn(async () => ({ ok: true }));
  const listeners: Array<(msg: unknown) => void> = [];
  const bot: TelegramBotLike = {
    sendMessage,
    on: (_event, listener) => {
      listeners.push(listener);
    },
    startPolling: vi.fn(async () => undefined),
    stopPolling: vi.fn(async () => undefined),
  };
  const emitMessage = (msg: unknown): void => {
    for (const l of listeners) l(msg);
  };
  return { bot, sendMessage, emitMessage };
}

function createFakeGraph(): IdentityGraph {
  return {
    getPerson: async () => null,
    resolveByHandle: async () => null,
    resolveByDescription: async () => [],
    getRelationship: async () => null,
    listFriends: async () => [],
    preferredPlatformBetween: async () => 'telegram',
  };
}

describe('createTelegramChannel', () => {
  it('no-ops (logs warning) when send targets a non-telegram handle', async () => {
    const warn = vi.fn();
    const { bot, sendMessage } = createFakeBot();
    const channel = createTelegramChannel({
      token: 'fake-token',
      graph: createFakeGraph(),
      botFactory: () => bot,
      warn,
    });

    const to: PlatformHandle = { platform: 'imessage', handle: '+81-111' };
    await channel.send(to, { text: 'hello' });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(channel.sent).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/non-telegram handle/);
  });

  it('sends to telegram chat id using handle when no preference is present', async () => {
    const { bot, sendMessage } = createFakeBot();
    const channel = createTelegramChannel({
      token: 'fake-token',
      graph: createFakeGraph(),
      botFactory: () => bot,
    });

    await channel.send({ platform: 'telegram', handle: '42' }, { text: 'hi' });

    expect(sendMessage).toHaveBeenCalledWith(42, 'hi');
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toMatchObject({
      platform: 'telegram',
      handle: '42',
      text: 'hi',
    });
  });

  it('prefers person.preferences.telegramChatId when available', async () => {
    const { bot, sendMessage } = createFakeBot();
    const person: Person = {
      id: 'mika',
      displayName: 'Mika',
      handles: [{ platform: 'telegram', handle: 'mika_handle' }],
      preferredPlatforms: ['telegram'],
      preferences: { telegramChatId: 99999 },
    };
    const graph: IdentityGraph = {
      ...createFakeGraph(),
      resolveByHandle: async () => person,
    };

    const channel = createTelegramChannel({
      token: 'fake-token',
      graph,
      botFactory: () => bot,
    });

    await channel.send({ platform: 'telegram', handle: 'mika_handle' }, { text: 'yo' });

    expect(sendMessage).toHaveBeenCalledWith(99999, 'yo');
  });

  it('forwards incoming telegram messages to onReceive handler with platform tag', async () => {
    const { bot, emitMessage } = createFakeBot();
    const channel = createTelegramChannel({
      token: 'fake-token',
      graph: createFakeGraph(),
      botFactory: () => bot,
    });

    const received: Array<{ from: PlatformHandle; text: string }> = [];
    channel.onReceive(async (from, text) => {
      received.push({ from, text });
    });

    emitMessage({ chat: { id: 123 }, text: 'hello from tg' });

    // Give the async handler a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      from: { platform: 'telegram', handle: '123' },
      text: 'hello from tg',
    });
  });

  it('start/stop toggle polling and emit platform-status events', async () => {
    const { bot } = createFakeBot();
    const channel = createTelegramChannel({
      token: 'fake-token',
      graph: createFakeGraph(),
      botFactory: () => bot,
    });

    const events: Array<{ type: string }> = [];
    channel.subscribe((e) => events.push({ type: e.type }));

    await channel.start();
    await channel.stop();

    expect(bot.startPolling).toHaveBeenCalledOnce();
    expect(bot.stopPolling).toHaveBeenCalledOnce();
    expect(events.filter((e) => e.type === 'channel:platform-status')).toHaveLength(2);
  });
});
