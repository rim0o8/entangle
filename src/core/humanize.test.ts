import { test, expect, describe } from 'bun:test';
import { humanize, stubHumanizer } from './humanize.ts';
import type { SealedIntent, BroadcastProbe } from './types.ts';
import type { Person } from '../engram/types.ts';

const stubIntent = (id: string): SealedIntent => ({
  id,
  ownerPersonId: 'yuri',
  targetPersonId: 'alex',
  kind: 'collaborate',
  payload: 'x',
  urgency: 'low',
  createdAt: new Date(),
  expiresAt: new Date(),
  state: 'sealed',
});

const stubProbe: BroadcastProbe = {
  id: 'p1',
  ownerPersonId: 'yuri',
  candidatePersonIds: ['a'],
  payload: 'run?',
  constraints: { when: 'Sun 10am' },
  createdAt: new Date(),
};

const stubPerson: Person = {
  id: 'a',
  displayName: 'A',
  handles: [{ platform: 'imessage', handle: '+1-555-0001' }],
  preferredPlatforms: ['imessage'],
  preferences: {},
  availability: 'free',
};

describe('humanize stub', () => {
  test('renderReveal is deterministic', async () => {
    const h = stubHumanizer();
    const a = stubIntent('aa');
    const b = stubIntent('bb');
    const text = await h.renderReveal(a, b);
    expect(text).toBe('[reveal: aa <-> bb]');
  });

  test('renderProbe is deterministic', async () => {
    const h = stubHumanizer();
    const text = await h.renderProbe(stubProbe, stubPerson);
    expect(text).toBe('[probe: p1 -> a]');
  });

  test('renderBubbleUp is deterministic', async () => {
    const h = stubHumanizer();
    const text = await h.renderBubbleUp(stubProbe, [stubPerson]);
    expect(text).toBe('[bubble-up: p1 yes=[a]]');
  });
});

describe('humanize factory', () => {
  test('HUMANIZE_STUB=1 returns the stub regardless of API key', async () => {
    expect(process.env.HUMANIZE_STUB).toBe('1');
    const h = humanize();
    const text = await h.renderReveal(stubIntent('a'), stubIntent('b'));
    expect(text).toBe('[reveal: a <-> b]');
  });
});
