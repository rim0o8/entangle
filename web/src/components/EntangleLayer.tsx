import type { WireEvent } from '../lib/ws.js';

export interface EntangleEnvelope {
  id: string;
  from: 'left' | 'right';
}

export interface BroadcastAvatar {
  id: string;
  name: string;
  status: 'suppressed' | 'probed' | 'yes' | 'no';
}

export interface EntangleLayerProps {
  envelopes: EntangleEnvelope[];
  mutual: boolean;
  broadcastAvatars?: BroadcastAvatar[];
  recentEvents?: WireEvent[];
  bubbleUpIds?: string[];
  threadOpened?: boolean;
}

const STATUS_CLASS: Record<BroadcastAvatar['status'], string> = {
  suppressed: 'bg-zinc-700 text-zinc-500 opacity-40',
  probed: 'bg-emerald-500/70 text-white animate-pulse',
  yes: 'bg-emerald-400 text-black',
  no: 'bg-red-500/70 text-white',
};

export function EntangleLayer({
  envelopes,
  mutual,
  broadcastAvatars = [],
  recentEvents = [],
  bubbleUpIds = [],
  threadOpened = false,
}: EntangleLayerProps): JSX.Element {
  return (
    <div
      className={`relative flex-1 bg-zinc-950 text-zinc-300 border-x border-zinc-800 overflow-hidden transition-all duration-500 ${
        threadOpened ? 'ring-2 ring-amber-300 shadow-[0_0_60px_rgba(251,191,36,0.4)]' : ''
      }`}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-6">
        <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">Entangle Layer</div>

        <div className="relative w-full h-40 flex items-center justify-center">
          {envelopes.map((env, i) => (
            <div
              key={env.id}
              className={`absolute text-4xl transition-all duration-700 ease-out ${
                mutual ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : ''
              }`}
              style={
                mutual
                  ? undefined
                  : {
                      left: env.from === 'left' ? '15%' : undefined,
                      right: env.from === 'right' ? '15%' : undefined,
                      top: `${30 + i * 10}%`,
                    }
              }
            >
              <span className="drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">✉</span>
            </div>
          ))}

          {mutual && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="absolute w-40 h-40 rounded-full bg-amber-300/20 blur-2xl animate-pulse" />
              <div className="text-amber-300 text-3xl font-bold tracking-[0.4em] z-10 animate-[fadeIn_600ms_ease-out]">
                MUTUAL
              </div>
            </div>
          )}
        </div>

        {broadcastAvatars.length > 0 && (
          <div className="grid grid-cols-5 gap-2 w-full max-w-sm">
            {broadcastAvatars.map((a) => (
              <div
                key={a.id}
                className={`relative flex items-center justify-center h-10 rounded-full text-xs font-semibold transition-all duration-500 ${
                  STATUS_CLASS[a.status]
                } ${bubbleUpIds.includes(a.id) ? 'animate-[bubbleUp_1200ms_ease-out]' : ''}`}
                title={`${a.name}: ${a.status}`}
              >
                {a.name.slice(0, 3)}
                {a.status === 'yes' && (
                  <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[9px] px-1 rounded">
                    YES
                  </span>
                )}
                {a.status === 'no' && (
                  <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[9px] px-1 rounded">
                    NO
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-black/60 border-t border-zinc-800 px-3 py-2 text-[10px] font-mono text-zinc-400 space-y-0.5 backdrop-blur">
        {recentEvents.slice(-5).map((e) => (
          <div key={`${e.at}-${e.type}`} className="truncate">
            <span className="text-zinc-500">[{e.at.slice(11, 19)}]</span> {e.type}
          </div>
        ))}
      </div>
    </div>
  );
}
