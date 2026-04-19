import { useMemo } from 'react';
import { type BroadcastAvatar, EntangleLayer } from '../components/EntangleLayer.js';
import { PhoneFrame, type PhoneMessage, type PlatformId } from '../components/PhoneFrame.js';
import { type WireEvent, useDemoEvents } from '../lib/ws.js';

const DISPLAY_NAMES: Record<string, string> = {
  yuri: 'Yuri',
  mika: 'Mika',
  taro: 'Taro',
  ken: 'Ken',
  busy1: 'Hana',
  busy2: 'Ren',
  busy3: 'Sora',
  busy4: 'Yui',
  busy5: 'Kai',
  busy6: 'Aoi',
  busy7: 'Riku',
  busy8: 'Nao',
  busy9: 'Emi',
  busy10: 'Jun',
  travel1: 'Lena',
  travel2: 'Omar',
  travel3: 'Priya',
  travel4: 'Sven',
  travel5: 'Tara',
  decline1: 'Mei',
  decline2: 'Raj',
};

const PLATFORM_BY_CANDIDATE: Record<string, PlatformId> = {
  mika: 'imessage',
  taro: 'whatsapp',
  ken: 'telegram',
};

interface State {
  yuri: PhoneMessage[];
  rights: Record<'mika' | 'taro' | 'ken', PhoneMessage[]>;
  avatars: BroadcastAvatar[];
  bubbleUpIds: string[];
  threadOpened: boolean;
}

function displayName(id: string): string {
  return DISPLAY_NAMES[id] ?? id;
}

function reduce(events: WireEvent[]): State {
  const yuri: PhoneMessage[] = [];
  const rights: State['rights'] = { mika: [], taro: [], ken: [] };
  const avatarById = new Map<string, BroadcastAvatar>();
  let bubbleUpIds: string[] = [];
  let threadOpened = false;

  for (const e of events) {
    const at = new Date(e.at);
    if (e.type === 'suppressed') {
      const p = e.payload as { candidateId?: string };
      const id = p.candidateId ?? 'unknown';
      avatarById.set(id, { id, name: displayName(id), status: 'suppressed' });
    } else if (e.type === 'probed') {
      const p = e.payload as { candidateId?: string; message?: string };
      const id = p.candidateId ?? 'unknown';
      avatarById.set(id, { id, name: displayName(id), status: 'probed' });
      if (id in rights) {
        const key = id as 'mika' | 'taro' | 'ken';
        rights[key].push({
          text: p.message ?? '',
          kind: 'incoming',
          at,
          platform: PLATFORM_BY_CANDIDATE[key] ?? 'telegram',
          id: `probe-${id}-${rights[key].length}`,
        });
      }
    } else if (e.type === 'response') {
      const p = e.payload as { from?: string; response?: 'yes' | 'no' };
      const id = p.from ?? 'unknown';
      const existing = avatarById.get(id);
      avatarById.set(id, {
        id,
        name: existing?.name ?? displayName(id),
        status: p.response ?? 'no',
      });
      if (id in rights) {
        const key = id as 'mika' | 'taro' | 'ken';
        rights[key].push({
          text: (p.response ?? '').toUpperCase(),
          kind: 'outgoing',
          at,
          platform: PLATFORM_BY_CANDIDATE[key] ?? 'telegram',
          id: `resp-${id}-${rights[key].length}`,
        });
      }
    } else if (e.type === 'bubble-up') {
      const p = e.payload as { yesResponders?: string[] };
      bubbleUpIds = p.yesResponders ?? [];
      for (const id of bubbleUpIds) {
        yuri.push({
          text: `${displayName(id)} is in.`,
          kind: 'incoming',
          at,
          platform: 'imessage',
          id: `bubble-${id}`,
        });
      }
    } else if (e.type === 'thread-opened') {
      threadOpened = true;
    }
  }

  return {
    yuri,
    rights,
    avatars: Array.from(avatarById.values()),
    bubbleUpIds,
    threadOpened,
  };
}

export function QuietBroadcast({ port = 8787 }: { port?: number }): JSX.Element {
  const events = useDemoEvents(port);
  const state = useMemo(() => reduce(events), [events]);

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col">
      <header className="px-6 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="text-sm font-semibold tracking-wide uppercase text-zinc-300">
          Entangle · Quiet Broadcast
        </div>
        <div className="text-xs text-zinc-500">events: {events.length}</div>
      </header>
      <main className="flex-1 flex items-stretch">
        <div className="flex items-center justify-center p-8">
          <PhoneFrame owner="yuri" platform="imessage" messages={state.yuri} label="Yuri" />
        </div>
        <EntangleLayer
          envelopes={[]}
          mutual={false}
          broadcastAvatars={state.avatars}
          bubbleUpIds={state.bubbleUpIds}
          threadOpened={state.threadOpened}
          recentEvents={events}
        />
        <div className="flex flex-col items-center justify-center gap-3 p-6">
          <PhoneFrame
            owner="mika"
            platform="imessage"
            messages={state.rights.mika}
            label="Mika"
            compact
          />
          <PhoneFrame
            owner="taro"
            platform="whatsapp"
            messages={state.rights.taro}
            label="Taro"
            compact
          />
          <PhoneFrame
            owner="ken"
            platform="telegram"
            messages={state.rights.ken}
            label="Ken"
            compact
          />
        </div>
      </main>
    </div>
  );
}
