import { useMemo } from 'react';
import { type EntangleEnvelope, EntangleLayer } from '../components/EntangleLayer.js';
import { PhoneFrame, type PhoneMessage, type PlatformId } from '../components/PhoneFrame.js';
import { type WireEvent, useDemoEvents } from '../lib/ws.js';

interface PhonePayload {
  yuri: PhoneMessage[];
  alex: PhoneMessage[];
  envelopes: EntangleEnvelope[];
  mutual: boolean;
  threadOpened: boolean;
}

function reduce(events: WireEvent[]): PhonePayload {
  const yuri: PhoneMessage[] = [];
  const alex: PhoneMessage[] = [];
  const envelopes: EntangleEnvelope[] = [];
  let mutual = false;
  let threadOpened = false;

  for (const e of events) {
    const at = new Date(e.at);
    if (e.type === 'sealed') {
      const payload = e.payload as { intent?: { ownerPersonId?: string; id?: string } };
      const owner = payload.intent?.ownerPersonId;
      const id = payload.intent?.id ?? `env-${envelopes.length}`;
      envelopes.push({ id, from: owner === 'yuri' ? 'left' : 'right' });
    } else if (e.type === 'mutual-detected') {
      mutual = true;
    } else if (e.type === 'reveal') {
      const p = e.payload as { to?: string; message?: string };
      const target = p.to === 'yuri' ? yuri : alex;
      const platform: PlatformId = p.to === 'yuri' ? 'imessage' : 'whatsapp';
      target.push({
        text: p.message ?? '',
        kind: 'incoming',
        at,
        platform,
        id: `reveal-${target.length}-${p.to}`,
      });
    } else if (e.type === 'channel:received') {
      const p = e.payload as { platform?: PlatformId; text?: string };
      const platform = p.platform ?? 'imessage';
      const target = platform === 'imessage' ? yuri : alex;
      target.push({
        text: p.text ?? '',
        kind: 'outgoing',
        at,
        platform,
        id: `recv-${target.length}-${platform}`,
      });
    } else if (e.type === 'thread-opened') {
      threadOpened = true;
    }
  }

  return { yuri, alex, envelopes, mutual, threadOpened };
}

export function DoubleYes({ port = 8787 }: { port?: number }): JSX.Element {
  const events = useDemoEvents(port);
  const state = useMemo(() => reduce(events), [events]);

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col">
      <header className="px-6 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="text-sm font-semibold tracking-wide uppercase text-zinc-300">
          Entangle · Double Yes
        </div>
        <div className="text-xs text-zinc-500">events: {events.length}</div>
      </header>
      <main className="flex-1 flex items-stretch">
        <div className="flex items-center justify-center p-8">
          <PhoneFrame owner="yuri" platform="imessage" messages={state.yuri} label="Yuri" />
        </div>
        <EntangleLayer
          envelopes={state.envelopes}
          mutual={state.mutual}
          threadOpened={state.threadOpened}
          recentEvents={events}
        />
        <div className="flex items-center justify-center p-8">
          <PhoneFrame owner="alex" platform="whatsapp" messages={state.alex} label="Alex" />
        </div>
      </main>
    </div>
  );
}
