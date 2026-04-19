import TelegramBot from 'node-telegram-bot-api';
import * as z from 'zod/v3';
import type { IdentityGraph, PlatformHandle, PlatformId } from '../engram/types.js';
import type { ChannelEvent, ChannelEventListener, MockChannel, SentRecord } from './mock.js';
import type { Channel, ChannelMessage, ChannelReceiver } from './types.js';

const TELEGRAM_PLATFORMS: readonly PlatformId[] = Object.freeze(['telegram']);

const IncomingMessageSchema = z.object({
  chat: z.object({
    id: z.union([z.number(), z.string()]),
  }),
  text: z.string().optional(),
});

export interface TelegramBotLike {
  sendMessage(chatId: number | string, text: string, options?: unknown): Promise<unknown>;
  on(event: 'message', listener: (msg: unknown) => void): void;
  startPolling?(): Promise<unknown> | undefined;
  stopPolling?(): Promise<unknown> | undefined;
}

export interface TelegramChannelOptions {
  token: string;
  graph: IdentityGraph;
  /**
   * Override the bot client (for testing). If omitted, a real
   * `node-telegram-bot-api` client is created.
   */
  botFactory?: (token: string) => TelegramBotLike;
  /**
   * Whether the adapter begins polling immediately. Default `false` — call
   * `.start()` explicitly to begin.
   */
  autoStart?: boolean;
  /**
   * Optional logger for internal warnings. Defaults to console.warn.
   */
  warn?: (message: string) => void;
}

export interface TelegramChannel extends Channel {
  readonly sent: ReadonlyArray<SentRecord>;
  readonly platforms: readonly PlatformId[];
  subscribe(listener: ChannelEventListener): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

function defaultBotFactory(token: string): TelegramBotLike {
  const bot = new TelegramBot(token, { polling: false });
  return {
    sendMessage: (chatId, text, options) =>
      bot.sendMessage(chatId, text, options as TelegramBot.SendMessageOptions | undefined),
    on: (event, listener) => {
      bot.on(event, listener as (msg: TelegramBot.Message) => void);
    },
    startPolling: () => bot.startPolling(),
    stopPolling: () => bot.stopPolling(),
  };
}

function toChatId(
  handle: PlatformHandle,
  person: {
    preferences: Record<string, unknown>;
  } | null
): string | number {
  if (person) {
    const pref = person.preferences.telegramChatId;
    if (typeof pref === 'string' || typeof pref === 'number') {
      return pref;
    }
  }
  const asNumber = Number(handle.handle);
  return Number.isFinite(asNumber) && `${asNumber}` === handle.handle ? asNumber : handle.handle;
}

export function createTelegramChannel(options: TelegramChannelOptions): TelegramChannel {
  const warn = options.warn ?? ((m: string) => console.warn(`[telegram] ${m}`));
  const bot = (options.botFactory ?? defaultBotFactory)(options.token);

  const sent: SentRecord[] = [];
  const receivers: ChannelReceiver[] = [];
  const listeners = new Set<ChannelEventListener>();
  let polling = false;

  const emit = (event: ChannelEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const send = async (to: PlatformHandle, message: ChannelMessage): Promise<void> => {
    if (to.platform !== 'telegram') {
      warn(`send called with non-telegram handle (platform=${to.platform}); ignoring`);
      return;
    }

    const person = await options.graph.resolveByHandle(to).catch(() => null);
    const chatId = toChatId(to, person);

    try {
      await bot.sendMessage(chatId, message.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`sendMessage failed to chat ${chatId}: ${msg}`);
      throw err;
    }

    const record: SentRecord = {
      platform: 'telegram',
      handle: to.handle,
      text: message.text,
      kind: message.kind,
      at: new Date(),
    };
    sent.push(record);
    emit({
      type: 'channel:sent',
      platform: record.platform,
      handle: record.handle,
      text: record.text,
      kind: record.kind,
      at: record.at,
    });
  };

  const onReceive = (handler: ChannelReceiver): void => {
    receivers.push(handler);
  };

  const subscribe = (listener: ChannelEventListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  bot.on('message', (raw) => {
    const parsed = IncomingMessageSchema.safeParse(raw);
    if (!parsed.success) {
      warn(`received malformed telegram message: ${parsed.error.message}`);
      return;
    }
    const chatId = String(parsed.data.chat.id);
    const text = parsed.data.text ?? '';
    const from: PlatformHandle = { platform: 'telegram', handle: chatId };

    emit({
      type: 'channel:received',
      platform: 'telegram',
      handle: chatId,
      text,
      at: new Date(),
    });

    for (const r of receivers) {
      r(from, text).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        warn(`onReceive handler failed: ${msg}`);
      });
    }
  });

  const start = async (): Promise<void> => {
    if (polling) return;
    if (typeof bot.startPolling === 'function') {
      await bot.startPolling();
    }
    polling = true;
    emit({
      type: 'channel:platform-status',
      platform: 'telegram',
      online: true,
      at: new Date(),
    });
  };

  const stop = async (): Promise<void> => {
    if (!polling) return;
    if (typeof bot.stopPolling === 'function') {
      await bot.stopPolling();
    }
    polling = false;
    emit({
      type: 'channel:platform-status',
      platform: 'telegram',
      online: false,
      at: new Date(),
    });
  };

  if (options.autoStart) {
    // fire and forget; callers can still await start() later.
    void start();
  }

  return {
    get sent(): ReadonlyArray<SentRecord> {
      return sent;
    },
    platforms: TELEGRAM_PLATFORMS,
    send,
    onReceive,
    subscribe,
    start,
    stop,
  };
}

export type { MockChannel };
