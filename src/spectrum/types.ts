import type { PlatformHandle } from '../engram/types.js';

export type MessageKind = 'prompt' | 'notice' | 'confirm';

export interface ChannelMessage {
  text: string;
  kind?: MessageKind;
}

export type ChannelReceiver = (from: PlatformHandle, text: string) => Promise<void>;

export interface Channel {
  send(to: PlatformHandle, message: ChannelMessage): Promise<void>;
  onReceive(handler: ChannelReceiver): void;
}
