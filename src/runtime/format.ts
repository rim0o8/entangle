import pc from 'picocolors';

// runtime/format.ts — dev-mode narration only. The one place picocolors is
// allowed to live. Library code in src/core and src/engram never prints.
//
// The structure of these lines is fixed by SPEC §3.6; the nanoids,
// timestamps, and humanized phrasing vary, but the prefixes and order do not.

export interface NarrationClock {
  readonly startedAt: number;
}

export function startNarrationClock(now: () => Date = () => new Date()): NarrationClock {
  return { startedAt: now().getTime() };
}

export function elapsed(clock: NarrationClock, now: () => Date = () => new Date()): string {
  const diffMs = Math.max(0, now().getTime() - clock.startedAt);
  const mins = Math.floor(diffMs / 60000);
  const secs = Math.floor((diffMs % 60000) / 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export interface Narrator {
  header(title: string, subtitle?: string): void;
  step(stamp: string, who: string, text: string): void;
  detail(text: string): void;
  matched(): void;
  done(elapsedSec: number): void;
}

export function consoleNarrator(): Narrator {
  return {
    header(title, subtitle) {
      const suf = subtitle ? pc.dim(` — ${subtitle}`) : '';
      console.log(`${pc.bold(pc.cyan('▸'))} ${pc.bold(title)}${suf}`);
      console.log('');
    },
    step(stamp, who, text) {
      console.log(`${pc.gray(`[${stamp}]`)} ${pc.magenta('●')} ${pc.bold(who.padEnd(7))} ${text}`);
    },
    detail(text) {
      console.log(`         ${pc.dim(text)}`);
    },
    matched() {
      console.log('');
      console.log(`         ${pc.bold(pc.green('✨ MATCHED'))}`);
      console.log('');
    },
    done(elapsedSec) {
      console.log(pc.gray(`done in ${elapsedSec.toFixed(1)}s — check your phone`));
    },
  };
}

export function silentNarrator(): Narrator {
  return {
    header() {},
    step() {},
    detail() {},
    matched() {},
    done() {},
  };
}
