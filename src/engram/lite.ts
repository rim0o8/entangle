import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  IdentityGraph,
  Person,
  PlatformHandle,
  PlatformId,
  Relationship,
  RelationshipType,
} from './types.js';
import { PlatformIdSchema, RelationshipTypeSchema } from './types.js';

interface PersonRow {
  id: string;
  display_name: string;
  preferred_platforms: string;
  preferences: string;
}

interface HandleRow {
  person_id: string;
  platform: string;
  handle: string;
}

interface RelationshipRow {
  from_id: string;
  to_id: string;
  type: string;
  last_contact_at: number | null;
  tags: string;
}

const DEFAULT_DB_PATH = '.entangle/db.sqlite';

export class EngramLite implements IdentityGraph {
  private readonly db: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    const dir = dirname(dbPath);
    if (dir && dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persons (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        preferred_platforms TEXT NOT NULL,
        preferences TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handles (
        person_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        handle TEXT NOT NULL,
        PRIMARY KEY (platform, handle)
      );

      CREATE INDEX IF NOT EXISTS idx_handles_person_id ON handles (person_id);

      CREATE TABLE IF NOT EXISTS relationships (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        last_contact_at INTEGER,
        tags TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id)
      );

      CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships (from_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  upsertPerson(person: Person): void {
    const insertPerson = this.db.prepare(
      `INSERT INTO persons (id, display_name, preferred_platforms, preferences)
       VALUES (@id, @displayName, @preferredPlatforms, @preferences)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         preferred_platforms = excluded.preferred_platforms,
         preferences = excluded.preferences`
    );
    const deleteHandles = this.db.prepare('DELETE FROM handles WHERE person_id = ?');
    const insertHandle = this.db.prepare(
      'INSERT OR REPLACE INTO handles (person_id, platform, handle) VALUES (?, ?, ?)'
    );

    const tx = this.db.transaction(() => {
      insertPerson.run({
        id: person.id,
        displayName: person.displayName,
        preferredPlatforms: JSON.stringify(person.preferredPlatforms),
        preferences: JSON.stringify(person.preferences),
      });
      deleteHandles.run(person.id);
      for (const h of person.handles) {
        insertHandle.run(person.id, h.platform, h.handle);
      }
    });
    tx();
  }

  upsertRelationship(rel: Relationship): void {
    const stmt = this.db.prepare(
      `INSERT INTO relationships (from_id, to_id, type, last_contact_at, tags)
       VALUES (@fromId, @toId, @type, @lastContactAt, @tags)
       ON CONFLICT(from_id, to_id) DO UPDATE SET
         type = excluded.type,
         last_contact_at = excluded.last_contact_at,
         tags = excluded.tags`
    );
    stmt.run({
      fromId: rel.fromId,
      toId: rel.toId,
      type: rel.type,
      lastContactAt: rel.lastContactAt ? rel.lastContactAt.getTime() : null,
      tags: JSON.stringify(rel.tags),
    });
  }

  async getPerson(id: string): Promise<Person | null> {
    return this.getPersonSync(id);
  }

  private getPersonSync(id: string): Person | null {
    const row = this.db
      .prepare(
        'SELECT id, display_name, preferred_platforms, preferences FROM persons WHERE id = ?'
      )
      .get(id) as PersonRow | undefined;
    if (!row) return null;
    return this.hydratePerson(row);
  }

  async resolveByHandle(handle: PlatformHandle): Promise<Person | null> {
    const row = this.db
      .prepare('SELECT person_id FROM handles WHERE platform = ? AND handle = ?')
      .get(handle.platform, handle.handle) as { person_id: string } | undefined;
    if (!row) return null;
    return this.getPersonSync(row.person_id);
  }

  async resolveByDescription(description: string, contextPersonId: string): Promise<Person[]> {
    const tokens = description
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];

    const relRows = this.db
      .prepare(
        'SELECT from_id, to_id, type, last_contact_at, tags FROM relationships WHERE from_id = ?'
      )
      .all(contextPersonId) as RelationshipRow[];

    const scored = relRows
      .map((relRow) => {
        const person = this.getPersonSync(relRow.to_id);
        if (!person) return null;
        const tags = JSON.parse(relRow.tags) as string[];
        const haystack = [
          person.displayName.toLowerCase(),
          ...tags.map((t) => t.toLowerCase()),
          JSON.stringify(person.preferences).toLowerCase(),
        ].join(' ');
        let score = 0;
        for (const token of tokens) {
          if (haystack.includes(token)) score += 1;
        }
        return { person, score };
      })
      .filter((x): x is { person: Person; score: number } => x !== null && x.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((s) => s.person);
  }

  async getRelationship(fromId: string, toId: string): Promise<Relationship | null> {
    const row = this.db
      .prepare(
        'SELECT from_id, to_id, type, last_contact_at, tags FROM relationships WHERE from_id = ? AND to_id = ?'
      )
      .get(fromId, toId) as RelationshipRow | undefined;
    if (!row) return null;
    return this.hydrateRelationship(row);
  }

  async listFriends(personId: string): Promise<Person[]> {
    const rows = this.db
      .prepare('SELECT to_id FROM relationships WHERE from_id = ?')
      .all(personId) as { to_id: string }[];
    const people: Person[] = [];
    for (const row of rows) {
      const p = this.getPersonSync(row.to_id);
      if (p) people.push(p);
    }
    return people;
  }

  async preferredPlatformBetween(fromId: string, toId: string): Promise<PlatformId> {
    const from = this.getPersonSync(fromId);
    const to = this.getPersonSync(toId);
    if (!from) throw new Error(`unknown person: ${fromId}`);
    if (!to) throw new Error(`unknown person: ${toId}`);

    const toPlatforms = new Set(to.handles.map((h) => h.platform));
    for (const platform of from.preferredPlatforms) {
      if (toPlatforms.has(platform)) return platform;
    }
    throw new Error('no shared platform');
  }

  private hydratePerson(row: PersonRow): Person {
    const preferredPlatformsRaw = JSON.parse(row.preferred_platforms) as unknown;
    const preferredPlatforms = Array.isArray(preferredPlatformsRaw)
      ? preferredPlatformsRaw.map((p) => PlatformIdSchema.parse(p))
      : [];
    const preferences = JSON.parse(row.preferences) as Record<string, unknown>;
    const handleRows = this.db
      .prepare('SELECT person_id, platform, handle FROM handles WHERE person_id = ?')
      .all(row.id) as HandleRow[];
    const handles: PlatformHandle[] = handleRows.map((h) => ({
      platform: PlatformIdSchema.parse(h.platform),
      handle: h.handle,
    }));
    return {
      id: row.id,
      displayName: row.display_name,
      handles,
      preferredPlatforms,
      preferences,
    };
  }

  private hydrateRelationship(row: RelationshipRow): Relationship {
    const tags = JSON.parse(row.tags) as string[];
    const type: RelationshipType = RelationshipTypeSchema.parse(row.type);
    return {
      fromId: row.from_id,
      toId: row.to_id,
      type,
      lastContactAt: row.last_contact_at !== null ? new Date(row.last_contact_at) : null,
      tags,
    };
  }
}
