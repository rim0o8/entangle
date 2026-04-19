import type { EntangleEvent } from './types.js';

export type EventHandler = (event: EntangleEvent) => void;

export interface EventLog {
  emit(event: EntangleEvent): void;
  subscribe(handler: EventHandler): () => void;
  snapshot(): EntangleEvent[];
}

export function createEventLog(): EventLog {
  const handlers = new Set<EventHandler>();
  const events: EntangleEvent[] = [];

  const emit = (event: EntangleEvent): void => {
    events.push(event);
    for (const h of handlers) {
      h(event);
    }
  };

  const subscribe = (handler: EventHandler): (() => void) => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  };

  const snapshot = (): EntangleEvent[] => events.map((e) => ({ ...e }));

  return { emit, subscribe, snapshot };
}
