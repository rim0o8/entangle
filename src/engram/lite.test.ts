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
    loadSeed(engram, { path: SEED_PATH, profile: 'test' });
  });

  afterEach(() => {
    engram.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('resolveByHandle', () => {
    it('finds Yuri by imessage handle', async () => {
      const person = await engram.resolveByHandle({
        platform: 'imessage',
        handle: '+1-555-0001',
      });
      expect(person).not.toBeNull();
      expect(person?.id).toBe('yuri');
      expect(person?.displayName).toBe('Yuri');
      expect(person?.availability).toBe('free');
      expect(person?.real).toBe(true);
    });

    it('finds Alex by imessage handle', async () => {
      const person = await engram.resolveByHandle({
        platform: 'imessage',
        handle: '+1-555-0002',
      });
      expect(person).not.toBeNull();
      expect(person?.id).toBe('alex');
    });

    it('returns null for unknown handle', async () => {
      const person = await engram.resolveByHandle({
        platform: 'imessage',
        handle: '+1-555-9999',
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

    it('all seed persons are on iMessage', async () => {
      const friends = await engram.listFriends('yuri');
      for (const f of friends) {
        for (const h of f.handles) {
          expect(h.platform).toBe('imessage');
        }
      }
    });
  });

  describe('preferredPlatformBetween', () => {
    it('returns imessage for any pair (v2 Phase 1)', async () => {
      const platform = await engram.preferredPlatformBetween('yuri', 'alex');
      expect(platform).toBe('imessage');
    });

    it('returns imessage even for unrelated pair', async () => {
      const platform = await engram.preferredPlatformBetween('yuri', 'mika');
      expect(platform).toBe('imessage');
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

      // alex only has a relationship with yuri; mika/taro/ken are not reachable.
      const alexMatches = await engram.resolveByDescription('jazz', 'alex');
      const alexIds = alexMatches.map((m) => m.id);
      expect(alexIds).not.toContain('mika');
      expect(alexIds).not.toContain('taro');
      expect(alexIds).not.toContain('ken');
    });
  });

  describe('loadSeed profiles', () => {
    it('demo profile throws if required env var missing', () => {
      const demoDir = mkdtempSync(join(tmpdir(), 'engram-demo-test-'));
      const demoDb = join(demoDir, 'd.sqlite');
      const demoEngram = new EngramLite(demoDb);
      try {
        expect(() => loadSeed(demoEngram, { path: SEED_PATH, profile: 'demo', env: {} })).toThrow(
          /YURI_APPLE_ID/
        );
      } finally {
        demoEngram.close();
        rmSync(demoDir, { recursive: true, force: true });
      }
    });

    it('demo profile overwrites the five real handles from env', async () => {
      const demoDir = mkdtempSync(join(tmpdir(), 'engram-demo-test-'));
      const demoDb = join(demoDir, 'd.sqlite');
      const demoEngram = new EngramLite(demoDb);
      try {
        loadSeed(demoEngram, {
          path: SEED_PATH,
          profile: 'demo',
          env: {
            YURI_APPLE_ID: '+81-1111',
            ALEX_APPLE_ID: '+1-2222',
            MIKA_APPLE_ID: '+81-3333',
            TARO_APPLE_ID: '+81-4444',
            KEN_APPLE_ID: '+81-5555',
          },
        });
        const yuri = await demoEngram.getPerson('yuri');
        expect(yuri?.handles[0]?.handle).toBe('+81-1111');
        const alex = await demoEngram.getPerson('alex');
        expect(alex?.handles[0]?.handle).toBe('+1-2222');
      } finally {
        demoEngram.close();
        rmSync(demoDir, { recursive: true, force: true });
      }
    });
  });
});
