import { useEffect, useState } from 'react';
import { DoubleYes } from './demos/DoubleYes.js';
import { QuietBroadcast } from './demos/QuietBroadcast.js';

type Route = 'landing' | 'double-yes' | 'quiet-broadcast';

function readRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path.endsWith('/double-yes')) return 'double-yes';
  if (path.endsWith('/quiet-broadcast')) return 'quiet-broadcast';
  const sp = new URLSearchParams(window.location.search).get('scenario');
  if (sp === 'double-yes') return 'double-yes';
  if (sp === 'quiet-broadcast') return 'quiet-broadcast';
  return 'landing';
}

function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ') {
        e.preventDefault();
        const root = document.getElementById('root');
        if (root) {
          const paused = root.dataset.paused === 'true';
          root.dataset.paused = paused ? 'false' : 'true';
          root.style.setProperty('--play-state', paused ? 'running' : 'paused');
        }
      } else if (e.key === 'r' || e.key === 'R') {
        window.location.reload();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

function Landing(): JSX.Element {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-8 font-sans">
      <h1 className="text-5xl font-bold tracking-tight">Entangle</h1>
      <p className="text-zinc-400 max-w-md text-center">
        The channel between agents. Where humans can't speak.
      </p>
      <div className="flex gap-6">
        <a
          href="/double-yes"
          className="px-6 py-4 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 transition"
        >
          Double Yes
        </a>
        <a
          href="/quiet-broadcast"
          className="px-6 py-4 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 transition"
        >
          Quiet Broadcast
        </a>
      </div>
      <div className="mt-12 text-xs text-zinc-600">Space: play/pause · R: restart</div>
    </div>
  );
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(() => readRoute());
  useKeyboardShortcuts();

  useEffect(() => {
    const onPop = (): void => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (route === 'double-yes') return <DoubleYes />;
  if (route === 'quiet-broadcast') return <QuietBroadcast />;
  return <Landing />;
}
