import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventSink, ProtocolEvent } from '../core/types.ts';

// Append-only JSONL event log. Each call to emit() flushes synchronously
// so that if the process is killed mid-scenario, we keep what was seen.
export function jsonlSink(path: string): EventSink {
  mkdirSync(dirname(path), { recursive: true });
  return {
    emit(event: ProtocolEvent) {
      const row = JSON.stringify({ ...event, at: event.at.toISOString() });
      appendFileSync(path, `${row}\n`);
    },
  };
}

export function inMemorySink(): EventSink & { events: ProtocolEvent[] } {
  const events: ProtocolEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
