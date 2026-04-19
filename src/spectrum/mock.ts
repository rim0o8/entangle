import type { PlatformHandle, PlatformId } from '../engram/types.js';
import type { Channel, ChannelMessage, ChannelReceiver, MessageKind } from './types.js';

const ALL_PLATFORMS: readonly PlatformId[] = Object.freeze([
  'imessage',
  'whatsapp',
  'telegram',
  'slack',
  'discord',
]);

export interface SentRecord {
  platform: PlatformId;
  handle: string;
  text: string;
  kind?: MessageKind;
  at: Date;
}

export type ChannelEvent =
  | {
      type: 'channel:sent';
      platform: PlatformId;
      handle: string;
      text: string;
      kind?: MessageKind;
      at: Date;
    }
  | {
      type: 'channel:received';
      platform: PlatformId;
      handle: string;
      text: string;
      at: Date;
    }
  | {
      type: 'channel:platform-status';
      platform: PlatformId;
      online: boolean;
      at: Date;
    };

export type ChannelEventListener = (event: ChannelEvent) => void;

export interface MockChannel extends Channel {
  readonly sent: ReadonlyArray<SentRecord>;
  readonly platforms: readonly PlatformId[];
  simulateReceive(from: PlatformHandle, text: string): Promise<void>;
  subscribe(listener: ChannelEventListener): () => void;
  setOnline(platform: PlatformId, online: boolean): void;
  clear(): void;
}

export interface MockChannelOptions {
  platforms?: readonly PlatformId[];
}

export function createMockChannel(options: MockChannelOptions = {}): MockChannel {
  const platforms: readonly PlatformId[] = Object.freeze([...(options.platforms ?? ALL_PLATFORMS)]);
  const sent: SentRecord[] = [];
  const receivers: ChannelReceiver[] = [];
  const listeners = new Set<ChannelEventListener>();

  const emit = (event: ChannelEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const send = async (to: PlatformHandle, message: ChannelMessage): Promise<void> => {
    const record: SentRecord = {
      platform: to.platform,
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

  const simulateReceive = async (from: PlatformHandle, text: string): Promise<void> => {
    emit({
      type: 'channel:received',
      platform: from.platform,
      handle: from.handle,
      text,
      at: new Date(),
    });
    for (const r of receivers) {
      await r({ ...from }, text);
    }
  };

  const subscribe = (listener: ChannelEventListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const setOnline = (platform: PlatformId, online: boolean): void => {
    emit({
      type: 'channel:platform-status',
      platform,
      online,
      at: new Date(),
    });
  };

  const clear = (): void => {
    sent.length = 0;
  };

  return {
    get sent(): ReadonlyArray<SentRecord> {
      return sent;
    },
    platforms,
    send,
    onReceive,
    simulateReceive,
    subscribe,
    setOnline,
    clear,
  };
}
