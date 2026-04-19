import type { IdentityGraph, PlatformHandle, PlatformId } from '../engram/types.js';
import {
  type ChannelEvent,
  type ChannelEventListener,
  type MockChannel,
  type SentRecord,
  createMockChannel,
} from './mock.js';
import { type TelegramChannel, createTelegramChannel } from './telegram.js';
import type { Channel, ChannelMessage, ChannelReceiver } from './types.js';

export interface CompositeChannel extends Channel {
  readonly sent: ReadonlyArray<SentRecord>;
  readonly platforms: readonly PlatformId[];
  readonly children: readonly ChildChannel[];
  subscribe(listener: ChannelEventListener): () => void;
}

export interface ChildChannel extends Channel {
  readonly sent: ReadonlyArray<SentRecord>;
  readonly platforms: readonly PlatformId[];
  subscribe(listener: ChannelEventListener): () => void;
}

export function createCompositeChannel(children: ChildChannel[]): CompositeChannel {
  if (children.length === 0) {
    throw new Error('createCompositeChannel requires at least one child');
  }

  const platforms: readonly PlatformId[] = Object.freeze(
    Array.from(new Set(children.flatMap((c) => c.platforms)))
  );

  const send = async (to: PlatformHandle, message: ChannelMessage): Promise<void> => {
    const target = children.find((c) => c.platforms.includes(to.platform));
    if (!target) {
      throw new Error(`no child channel claims platform ${to.platform}`);
    }
    await target.send(to, message);
  };

  const onReceive = (handler: ChannelReceiver): void => {
    for (const c of children) {
      c.onReceive(handler);
    }
  };

  const subscribe = (listener: ChannelEventListener): (() => void) => {
    const unsubs = children.map((c) => c.subscribe(listener));
    return () => {
      for (const u of unsubs) u();
    };
  };

  return {
    get sent(): ReadonlyArray<SentRecord> {
      const merged: SentRecord[] = [];
      for (const c of children) {
        merged.push(...c.sent);
      }
      return merged;
    },
    platforms,
    children: Object.freeze([...children]),
    send,
    onReceive,
    subscribe,
  };
}

export interface SelectChannelDeps {
  graph: IdentityGraph;
  /**
   * Override env lookup (useful for tests). Defaults to `process.env`.
   */
  env?: Record<string, string | undefined>;
}

export type SelectedChannel = MockChannel | CompositeChannel;

export function createChannelFromEnv(deps: SelectChannelDeps): SelectedChannel {
  const env = deps.env ?? process.env;
  const token = env.TELEGRAM_BOT_TOKEN;

  if (typeof token === 'string' && token.length > 0) {
    // Mock claims all 5 platforms; Telegram claims only telegram.
    // Ordering matters: telegram first so it wins for telegram handles.
    const telegram: TelegramChannel = createTelegramChannel({ token, graph: deps.graph });
    // Mock uses all platforms EXCEPT telegram to avoid double-claim.
    const mock = createMockChannel({
      platforms: ['imessage', 'whatsapp', 'slack', 'discord'],
    });
    return createCompositeChannel([telegram, mock]);
  }

  return createMockChannel();
}

export type { ChannelEvent, ChannelEventListener };
