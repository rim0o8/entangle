import type { MessageKind, Messenger } from '../core/types.js';
import type { PlatformHandle, PlatformId } from '../engram/types.js';

const ALL_PLATFORMS: readonly PlatformId[] = Object.freeze(['imessage']);

export interface SentRecord {
  platform: PlatformId;
  handle: string;
  text: string;
  kind?: MessageKind;
  at: Date;
}

export type MessengerEvent =
  | {
      type: 'messenger:sent';
      platform: PlatformId;
      handle: string;
      text: string;
      kind?: MessageKind;
      at: Date;
    }
  | {
      type: 'messenger:received';
      platform: PlatformId;
      handle: string;
      text: string;
      at: Date;
    }
  | {
      type: 'messenger:platform-status';
      platform: PlatformId;
      online: boolean;
      at: Date;
    };

export type MessengerEventListener = (event: MessengerEvent) => void;

type ReceiveHandler = (from: PlatformHandle, text: string) => Promise<void>;

export interface TestMessenger extends Messenger {
  readonly sent: ReadonlyArray<SentRecord>;
  readonly platforms: readonly PlatformId[];
  simulateReceive(from: PlatformHandle, text: string): Promise<void>;
  subscribe(listener: MessengerEventListener): () => void;
  setOnline(platform: PlatformId, online: boolean): void;
  clear(): void;
}

export interface TestMessengerOptions {
  platforms?: readonly PlatformId[];
}

export function createTestMessenger(options: TestMessengerOptions = {}): TestMessenger {
  const platforms: readonly PlatformId[] = Object.freeze([...(options.platforms ?? ALL_PLATFORMS)]);
  const sent: SentRecord[] = [];
  const receivers: ReceiveHandler[] = [];
  const listeners = new Set<MessengerEventListener>();

  const emit = (event: MessengerEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const send = async (
    to: PlatformHandle,
    message: { text: string; kind?: MessageKind }
  ): Promise<void> => {
    const record: SentRecord = {
      platform: to.platform,
      handle: to.handle,
      text: message.text,
      kind: message.kind,
      at: new Date(),
    };
    sent.push(record);
    emit({
      type: 'messenger:sent',
      platform: record.platform,
      handle: record.handle,
      text: record.text,
      kind: record.kind,
      at: record.at,
    });
  };

  const onReceive = (handler: ReceiveHandler): void => {
    receivers.push(handler);
  };

  const simulateReceive = async (from: PlatformHandle, text: string): Promise<void> => {
    emit({
      type: 'messenger:received',
      platform: from.platform,
      handle: from.handle,
      text,
      at: new Date(),
    });
    for (const r of receivers) {
      await r({ ...from }, text);
    }
  };

  const subscribe = (listener: MessengerEventListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const setOnline = (platform: PlatformId, online: boolean): void => {
    emit({
      type: 'messenger:platform-status',
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
