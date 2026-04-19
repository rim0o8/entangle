import { describe, expect, it } from 'vitest';
import { createEventLog } from './events.js';
import type { EntangleEvent } from './types.js';

describe('EventLog', () => {
  it('emits events to subscribers and snapshot', () => {
    const log = createEventLog();
    const received: EntangleEvent[] = [];
    log.subscribe((e) => received.push(e));

    const event: EntangleEvent = {
      type: 'sealed',
      at: new Date(),
      intent: {
        id: 'i',
        ownerPersonId: 'yuri',
        targetPersonId: 'alex',
        kind: 'collaborate',
        payload: 'p',
        urgency: 'med',
        createdAt: new Date(),
        expiresAt: new Date(),
        state: 'sealed',
      },
    };
    log.emit(event);
    expect(received.length).toBe(1);
    expect(log.snapshot().length).toBe(1);
  });

  it('unsubscribe stops delivery but preserves snapshot', () => {
    const log = createEventLog();
    const received: EntangleEvent[] = [];
    const unsub = log.subscribe((e) => received.push(e));
    unsub();
    log.emit({
      type: 'broadcast-started',
      at: new Date(),
      probeId: 'p',
      candidateCount: 1,
    });
    expect(received.length).toBe(0);
    expect(log.snapshot().length).toBe(1);
  });
});
