import { useEffect, useRef } from 'react';

export type PlatformId = 'imessage' | 'whatsapp' | 'telegram' | 'slack' | 'discord';
export type Owner = 'yuri' | 'alex' | 'mika' | 'taro' | 'ken' | 'generic';

export interface PhoneMessage {
  text: string;
  kind: 'incoming' | 'outgoing';
  at: Date;
  platform: PlatformId;
  id?: string;
}

export interface PhoneFrameProps {
  owner: Owner;
  platform: PlatformId;
  messages: PhoneMessage[];
  label?: string;
  compact?: boolean;
}

const OWNER_DISPLAY: Record<Owner, string> = {
  yuri: 'Yuri',
  alex: 'Alex',
  mika: 'Mika',
  taro: 'Taro',
  ken: 'Ken',
  generic: 'Contact',
};

const PLATFORM_LABEL: Record<PlatformId, string> = {
  imessage: 'iMessage',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  slack: 'Slack',
  discord: 'Discord',
};

interface PlatformTheme {
  headerBg: string;
  headerText: string;
  bodyBg: string;
  outgoing: string;
  incoming: string;
  radius: string;
}

const PLATFORM_THEME: Record<PlatformId, PlatformTheme> = {
  imessage: {
    headerBg: 'bg-zinc-900 text-zinc-100',
    headerText: 'text-zinc-100',
    bodyBg: 'bg-zinc-950',
    outgoing: 'bg-blue-500 text-white',
    incoming: 'bg-gray-200 text-black',
    radius: 'rounded-2xl',
  },
  whatsapp: {
    headerBg: 'bg-emerald-900 text-white',
    headerText: 'text-white',
    bodyBg: 'bg-[#0b141a]',
    outgoing: 'bg-emerald-500 text-white',
    incoming: 'bg-white text-black border border-zinc-300',
    radius: 'rounded-lg',
  },
  telegram: {
    headerBg: 'bg-sky-800 text-white',
    headerText: 'text-white',
    bodyBg: 'bg-slate-900',
    outgoing: 'bg-sky-500 text-white',
    incoming: 'bg-sky-100 text-black',
    radius: 'rounded-xl',
  },
  slack: {
    headerBg: 'bg-purple-900 text-white',
    headerText: 'text-white',
    bodyBg: 'bg-zinc-950',
    outgoing: 'bg-purple-500 text-white',
    incoming: 'bg-zinc-200 text-black',
    radius: 'rounded-lg',
  },
  discord: {
    headerBg: 'bg-indigo-900 text-white',
    headerText: 'text-white',
    bodyBg: 'bg-zinc-900',
    outgoing: 'bg-indigo-500 text-white',
    incoming: 'bg-zinc-700 text-white',
    radius: 'rounded-xl',
  },
};

function formatTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function PhoneFrame({
  owner,
  platform,
  messages,
  label,
  compact = false,
}: PhoneFrameProps): JSX.Element {
  const theme = PLATFORM_THEME[platform];
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const messageCount = messages.length;
  useEffect(() => {
    if (messageCount < 0) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messageCount]);

  const width = compact ? 'w-[180px]' : 'w-[280px]';
  const height = compact ? 'h-[360px]' : 'h-[560px]';

  return (
    <div
      className={`${width} ${height} rounded-[3rem] border border-zinc-700 shadow-2xl bg-black overflow-hidden flex flex-col`}
    >
      <div className={`${theme.headerBg} px-4 py-2 text-xs font-semibold flex justify-between`}>
        <span>{PLATFORM_LABEL[platform]}</span>
        <span className={theme.headerText}>{label ?? OWNER_DISPLAY[owner]}</span>
      </div>
      <div ref={bodyRef} className={`${theme.bodyBg} flex-1 overflow-y-auto p-3 space-y-2 text-sm`}>
        {messages.map((m, idx) => (
          <div
            key={m.id ?? `${m.at.getTime()}-${idx}`}
            className={`flex ${m.kind === 'outgoing' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`${m.kind === 'outgoing' ? theme.outgoing : theme.incoming} ${
                theme.radius
              } px-3 py-2 max-w-[80%] shadow animate-[fadeIn_300ms_ease-out]`}
            >
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              <div className="text-[10px] opacity-70 mt-1 text-right">{formatTime(m.at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
