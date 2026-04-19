import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { EngramLite } from './lite.ts';
import { resolveSeed, applySeed } from './seed.ts';
import type { Person } from './types.ts';

function freshEngram(): EngramLite {
  return new EngramLite(new Database(':memory:'));
}

const basePerson = (id: string, handle: string): Person => ({
  id,
  displayName: id,
  handles: [{ platform: 'imessage', handle }],
  preferredPlatforms: ['imessage'],
  preferences: {},
  availability: 'free',
});

describe('EngramLite', () => {
  test('resolveByHandle finds by exact match', async () => {
    const e = freshEngram();
    e.upsertPerson(basePerson('yuri', '+1-555-0101'));
    e.upsertPerson(basePerson('alex', '+1-555-0102'));

    const found = await e.resolveByHandle({ platform: 'imessage', handle: '+1-555-0101' });
    expect(found?.id).toBe('yuri');

    const notFound = await e.resolveByHandle({ platform: 'imessage', handle: '+1-555-9999' });
    expect(notFound).toBeNull();
  });

  test('getRelationship returns null for unknown, correct for known', async () => {
    const e = freshEngram();
    e.upsertPerson(basePerson('a', '+1-555-0001'));
    e.upsertPerson(basePerson('b', '+1-555-0002'));
    e.upsertRelationship({
      fromId: 'a',
      toId: 'b',
      type: 'colleague',
      lastContactAt: null,
      tags: ['hex'],
    });

    const known = await e.getRelationship('a', 'b');
    expect(known?.type).toBe('colleague');
    expect(known?.tags).toEqual(['hex']);

    const unknown = await e.getRelationship('a', 'c');
    expect(unknown).toBeNull();
  });

  test('listFriends returns all second-degree persons from a given id', async () => {
    const e = freshEngram();
    for (const id of ['yuri', 'alex', 'mika', 'taro']) {
      e.upsertPerson(basePerson(id, `+1-555-99-${id}`));
    }
    for (const peer of ['alex', 'mika', 'taro']) {
      e.upsertRelationship({
        fromId: 'yuri',
        toId: peer,
        type: 'friend',
        lastContactAt: null,
        tags: [],
      });
    }
    const friends = await e.listFriends('yuri');
    expect(friends.map((p) => p.id).sort()).toEqual(['alex', 'mika', 'taro']);
  });
});

describe('seed loader', () => {
  test('test profile loads exactly 20 persons and substitutes placeholders', () => {
    const loaded = resolveSeed({
      path: 'data/seed.json',
      profile: 'test',
      env: {},
    });
    expect(loaded.persons.length).toBe(20);
    const yuri = loaded.persons.find((p) => p.id === 'yuri');
    expect(yuri?.handles[0]?.handle.startsWith('+1-555-')).toBe(true);
  });

  test('demo profile substitutes env vars and fails fast when missing', () => {
    const okEnv = {
      YURI_HANDLE: 'test-handle-yuri',
      ALEX_HANDLE: 'test-handle-alex',
      MIKA_HANDLE: 'test-handle-mika',
      TARO_HANDLE: 'test-handle-taro',
      KEN_HANDLE: 'test-handle-ken',
    } as NodeJS.ProcessEnv;
    const loaded = resolveSeed({ path: 'data/seed.json', profile: 'demo', env: okEnv });
    const yuri = loaded.persons.find((p) => p.id === 'yuri');
    expect(yuri?.handles[0]?.handle).toBe('test-handle-yuri');

    const badEnv = { ...okEnv, ALEX_HANDLE: '' };
    expect(() =>
      resolveSeed({ path: 'data/seed.json', profile: 'demo', env: badEnv }),
    ).toThrow(/ALEX_HANDLE/);
  });

  test('applySeed makes relationships queryable', async () => {
    const e = freshEngram();
    const seed = resolveSeed({ path: 'data/seed.json', profile: 'test', env: {} });
    applySeed(e, seed);
    expect(e.countPersons()).toBe(20);
    const rel = await e.getRelationship('yuri', 'alex');
    expect(rel?.type).toBe('collaborator');
  });

  test('.env is in .gitignore and pre-commit hook exists', async () => {
    const fs = await import('node:fs');
    const gi = fs.readFileSync('.gitignore', 'utf8');
    expect(gi).toMatch(/^\.env$/m);
    expect(fs.existsSync('.githooks/pre-commit')).toBe(true);
  });
});
