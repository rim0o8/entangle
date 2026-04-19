import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngramLite } from './lite.js';
import { loadSeed } from './seed.js';

const SEED_PATH = join(__dirname, 'seed.json');

describe('EngramLite', () => {
  let engram: EngramLite;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'engram-test-'));
    dbPath = join(tempDir, 'test.sqlite');
    engram = new EngramLite(dbPath);
    loadSeed(engram, SEED_PATH);
  });

  afterEach(() => {
    engram.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('resolveByHandle', () => {
    it('finds Yuri by imessage handle', async () => {
      const person = await engram.resolveByHandle({
        platform: 'imessage',
        handle: '+81-9012345678',
      });
      expect(person).not.toBeNull();
      expect(person?.id).toBe('yuri');
      expect(person?.displayName).toBe('Yuri');
    });

    it('finds Alex by whatsapp handle', async () => {
      const person = await engram.resolveByHandle({
        platform: 'whatsapp',
        handle: '+1-5551234567',
      });
      expect(person).not.toBeNull();
      expect(person?.id).toBe('alex');
      expect(person?.displayName).toBe('Alex');
    });

    it('returns null for unknown handle', async () => {
      const person = await engram.resolveByHandle({
        platform: 'imessage',
        handle: '+1-0000000000',
      });
      expect(person).toBeNull();
    });
  });

  describe('getRelationship', () => {
    it('returns the Yuri -> Alex relationship', async () => {
      const rel = await engram.getRelationship('yuri', 'alex');
      expect(rel).not.toBeNull();
      expect(rel?.type).toBe('met-once');
      expect(rel?.tags).toEqual(['conf']);
      expect(rel?.lastContactAt).toBeInstanceOf(Date);
    });

    it('returns the Alex -> Yuri mirror relationship', async () => {
      const rel = await engram.getRelationship('alex', 'yuri');
      expect(rel).not.toBeNull();
      expect(rel?.type).toBe('met-once');
    });
  });

  describe('listFriends', () => {
    it('returns at least 20 friends of Yuri', async () => {
      const friends = await engram.listFriends('yuri');
      expect(friends.length).toBeGreaterThanOrEqual(20);
    });

    it('covers all 5 platforms across seed data', async () => {
      const friends = await engram.listFriends('yuri');
      const platforms = new Set<string>();
      for (const f of friends) {
        for (const h of f.handles) platforms.add(h.platform);
      }
      expect(platforms.size).toBeGreaterThanOrEqual(5);
    });
  });

  describe('preferredPlatformBetween', () => {
    it('returns a platform both parties share for yuri -> alex', async () => {
      const platform = await engram.preferredPlatformBetween('yuri', 'alex');
      expect(['whatsapp', 'slack']).toContain(platform);

      const yuri = await engram.getPerson('yuri');
      const alex = await engram.getPerson('alex');
      const alexPlatforms = new Set(alex?.handles.map((h) => h.platform));
      expect(yuri?.preferredPlatforms).toContain(platform);
      expect(alexPlatforms.has(platform)).toBe(true);
    });

    it('throws when no shared platform', async () => {
      const only = new EngramLite(join(tempDir, 'only.sqlite'));
      only.upsertPerson({
        id: 'a',
        displayName: 'A',
        handles: [{ platform: 'imessage', handle: 'a' }],
        preferredPlatforms: ['imessage'],
        preferences: {},
      });
      only.upsertPerson({
        id: 'b',
        displayName: 'B',
        handles: [{ platform: 'telegram', handle: 'b' }],
        preferredPlatforms: ['telegram'],
        preferences: {},
      });
      await expect(only.preferredPlatformBetween('a', 'b')).rejects.toThrow('no shared platform');
      only.close();
    });
  });

  describe('resolveByDescription', () => {
    it('returns the 3 jazz-loving free candidates', async () => {
      const matches = await engram.resolveByDescription('jazz', 'yuri');
      const ids = matches.map((m) => m.id).sort();
      expect(ids).toEqual(['ken', 'mika', 'taro']);
    });

    it('filters to people the context person has a relationship with', async () => {
      // yuri has 3 jazz-loving friends
      const yuriMatches = await engram.resolveByDescription('jazz', 'yuri');
      expect(yuriMatches.length).toBe(3);

      // alex only has a relationship with yuri; if yuri matches "jazz" (preferences),
      // only yuri is returned — mika/taro/ken are not reachable from alex.
      const alexMatches = await engram.resolveByDescription('jazz', 'alex');
      const alexIds = alexMatches.map((m) => m.id);
      expect(alexIds).not.toContain('mika');
      expect(alexIds).not.toContain('taro');
      expect(alexIds).not.toContain('ken');
    });
  });
});
