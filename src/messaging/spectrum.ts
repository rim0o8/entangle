import type { SpectrumInstance } from 'spectrum-ts';
import { text as textContent } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import type { Messenger, OutboundMessage } from '../core/types.ts';
import type { PlatformHandle } from '../engram/types.ts';

// SpectrumMessenger — adapts a spectrum-ts SpectrumInstance to Entangle's
// Messenger port. Only iMessage platform handles are supported.
//
// The receive loop starts lazily the first time onReceive is called so that
// scripts which only want to send (e.g. the dev orchestrator) never pay the
// cost of subscribing to the event stream.
export class SpectrumMessenger implements Messenger {
  private readonly handlers: Array<(from: PlatformHandle, text: string) => Promise<void>> = [];
  private receiveLoop?: Promise<void>;
  private stopping = false;

  constructor(private readonly spectrum: SpectrumInstance) {}

  async send(to: PlatformHandle, message: OutboundMessage): Promise<void> {
    if (to.platform !== 'imessage') {
      throw new Error(`SpectrumMessenger: unsupported platform ${to.platform}`);
    }
    const platform = imessage(this.spectrum);
    const space = await platform.space({ users: [{ id: to.handle }] });
    await this.spectrum.send(space, textContent(message.text));
  }

  onReceive(handler: (from: PlatformHandle, text: string) => Promise<void>): void {
    this.handlers.push(handler);
    if (!this.receiveLoop) this.receiveLoop = this.runReceiveLoop();
  }

  private async runReceiveLoop(): Promise<void> {
    for await (const [, message] of this.spectrum.messages) {
      if (this.stopping) break;
      const sender = message.sender as { id: string };
      const from: PlatformHandle = { platform: 'imessage', handle: sender.id };
      const content = message.content;
      if (content.type !== 'text') continue;
      for (const h of this.handlers) {
        try {
          await h(from, content.text);
        } catch (err) {
          console.error('SpectrumMessenger: handler error', err);
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.spectrum.stop();
    if (this.receiveLoop) await this.receiveLoop;
  }
}

export interface SpectrumConfig {
  projectId: string;
  projectSecret: string;
}

// Factory that boots a SpectrumInstance against a project with iMessage
// enabled in cloud mode. Used by runtime/agent.ts and runtime/dev.ts.
export async function bootSpectrum(cfg: SpectrumConfig): Promise<SpectrumInstance> {
  const { Spectrum } = await import('spectrum-ts');
  return await Spectrum({
    projectId: cfg.projectId,
    projectSecret: cfg.projectSecret,
    providers: [imessage.config({ local: false })],
  });
}
