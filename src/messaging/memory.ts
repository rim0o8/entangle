import type {
  Messenger,
  OutboundMessage,
} from '../core/types.ts';
import type { PlatformHandle } from '../engram/types.ts';

// MemoryMessenger — test double for the Messenger port.
// Captures every send into \`sent\` for assertions. \`onReceive\` can be
// fired from tests via \`deliver()\`.
export class MemoryMessenger implements Messenger {
  readonly sent: { to: PlatformHandle; message: OutboundMessage }[] = [];
  private handlers: ((from: PlatformHandle, text: string) => Promise<void>)[] = [];

  async send(to: PlatformHandle, message: OutboundMessage): Promise<void> {
    this.sent.push({ to, message });
  }

  onReceive(handler: (from: PlatformHandle, text: string) => Promise<void>): void {
    this.handlers.push(handler);
  }

  /** Simulate an incoming message; fan out to every subscribed handler. */
  async deliver(from: PlatformHandle, text: string): Promise<void> {
    for (const h of this.handlers) await h(from, text);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
