import type { PlatformHandle } from '../engram/types.js';
import type { Channel, ChannelMessage, ChannelReceiver } from './types.js';

export interface SentRecord {
  to: PlatformHandle;
  text: string;
  kind?: ChannelMessage['kind'];
  at: Date;
}

export interface InProcessChannel extends Channel {
  readonly sent: SentRecord[];
  trigger(from: PlatformHandle, text: string): Promise<void>;
  clear(): void;
}

export function createInProcessChannel(): InProcessChannel {
  const sent: SentRecord[] = [];
  const receivers: ChannelReceiver[] = [];

  const send = async (to: PlatformHandle, message: ChannelMessage): Promise<void> => {
    sent.push({ to: { ...to }, text: message.text, kind: message.kind, at: new Date() });
  };

  const onReceive = (handler: ChannelReceiver): void => {
    receivers.push(handler);
  };

  const trigger = async (from: PlatformHandle, text: string): Promise<void> => {
    for (const r of receivers) {
      await r({ ...from }, text);
    }
  };

  const clear = (): void => {
    sent.length = 0;
  };

  return { sent, send, onReceive, trigger, clear };
}
