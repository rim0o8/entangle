import { Database } from 'bun:sqlite';
import type {
  IdentityGraph,
  Person,
  PlatformHandle,
  Relationship,
} from './types.ts';

// EngramLite — a SQLite-backed IdentityGraph.
//
// Two small tables, JSON blobs for the repeating fields. This is a demo-grade
// identity graph, not a production one.
export class EngramLite implements IdentityGraph {
  private readonly db: Database;
  private readonly stmts: {
    getPerson: ReturnType<Database['prepare']>;
    getPersonByHandleLike: ReturnType<Database['prepare']>;
    getRelationship: ReturnType<Database['prepare']>;
    listFriends: ReturnType<Database['prepare']>;
    upsertPerson: ReturnType<Database['prepare']>;
    upsertRelationship: ReturnType<Database['prepare']>;
    countPersons: ReturnType<Database['prepare']>;
    listPersons: ReturnType<Database['prepare']>;
  };

  constructor(db: Database) {
    this.db = db;
    this.db.exec('PRAGMA journal_mode=WAL;');
    this.db.exec('PRAGMA foreign_keys=ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persons (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        handles TEXT NOT NULL,
        preferred_platforms TEXT NOT NULL,
        preferences TEXT NOT NULL,
        availability TEXT
      );
      CREATE TABLE IF NOT EXISTS relationships (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        last_contact_at INTEGER,
        tags TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id),
        FOREIGN KEY (from_id) REFERENCES persons(id),
        FOREIGN KEY (to_id) REFERENCES persons(id)
      );
      CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id);
    `);

    this.stmts = {
      getPerson: this.db.prepare('SELECT * FROM persons WHERE id = ?'),
      // JSON handle match: use LIKE for embedded JSON object.
      getPersonByHandleLike: this.db.prepare(
        "SELECT * FROM persons WHERE handles LIKE ?",
      ),
      getRelationship: this.db.prepare(
        'SELECT * FROM relationships WHERE from_id = ? AND to_id = ?',
      ),
      listFriends: this.db.prepare(
        'SELECT p.* FROM persons p JOIN relationships r ON r.to_id = p.id WHERE r.from_id = ?',
      ),
      upsertPerson: this.db.prepare(
        `INSERT INTO persons (id, display_name, handles, preferred_platforms, preferences, availability)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name=excluded.display_name,
           handles=excluded.handles,
           preferred_platforms=excluded.preferred_platforms,
           preferences=excluded.preferences,
           availability=excluded.availability`,
      ),
      upsertRelationship: this.db.prepare(
        `INSERT INTO relationships (from_id, to_id, type, last_contact_at, tags)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(from_id, to_id) DO UPDATE SET
           type=excluded.type,
           last_contact_at=excluded.last_contact_at,
           tags=excluded.tags`,
      ),
      countPersons: this.db.prepare('SELECT COUNT(*) as n FROM persons'),
      listPersons: this.db.prepare('SELECT * FROM persons ORDER BY id'),
    };
  }

  upsertPerson(person: Person): void {
    this.stmts.upsertPerson.run(
      person.id,
      person.displayName,
      JSON.stringify(person.handles),
      JSON.stringify(person.preferredPlatforms),
      JSON.stringify(person.preferences),
      person.availability ?? null,
    );
  }

  upsertRelationship(rel: Relationship): void {
    this.stmts.upsertRelationship.run(
      rel.fromId,
      rel.toId,
      rel.type,
      rel.lastContactAt ? rel.lastContactAt.getTime() : null,
      JSON.stringify(rel.tags),
    );
  }

  countPersons(): number {
    const r = this.stmts.countPersons.get() as { n: number } | null;
    return r?.n ?? 0;
  }

  listPersons(): Person[] {
    const rows = this.stmts.listPersons.all() as PersonRow[];
    return rows.map(rowToPerson);
  }

  async getPerson(id: string): Promise<Person | null> {
    const row = this.stmts.getPerson.get(id) as PersonRow | null;
    return row ? rowToPerson(row) : null;
  }

  async resolveByHandle(handle: PlatformHandle): Promise<Person | null> {
    // Match persons whose handles JSON contains this exact platform+handle pair.
    const needle = `%"platform":"${handle.platform}","handle":"${handle.handle}"%`;
    const rows = this.stmts.getPersonByHandleLike.all(needle) as PersonRow[];
    for (const row of rows) {
      const p = rowToPerson(row);
      if (
        p.handles.some(
          (h) => h.platform === handle.platform && h.handle === handle.handle,
        )
      ) {
        return p;
      }
    }
    return null;
  }

  async getRelationship(fromId: string, toId: string): Promise<Relationship | null> {
    const row = this.stmts.getRelationship.get(fromId, toId) as RelationshipRow | null;
    return row ? rowToRelationship(row) : null;
  }

  async listFriends(personId: string): Promise<Person[]> {
    const rows = this.stmts.listFriends.all(personId) as PersonRow[];
    return rows.map(rowToPerson);
  }
}

interface PersonRow {
  id: string;
  display_name: string;
  handles: string;
  preferred_platforms: string;
  preferences: string;
  availability: string | null;
}
interface RelationshipRow {
  from_id: string;
  to_id: string;
  type: string;
  last_contact_at: number | null;
  tags: string;
}

function rowToPerson(row: PersonRow): Person {
  const out: Person = {
    id: row.id,
    displayName: row.display_name,
    handles: JSON.parse(row.handles),
    preferredPlatforms: JSON.parse(row.preferred_platforms),
    preferences: JSON.parse(row.preferences),
  };
  if (row.availability !== null) out.availability = row.availability as Person['availability'];
  return out;
}

function rowToRelationship(row: RelationshipRow): Relationship {
  return {
    fromId: row.from_id,
    toId: row.to_id,
    type: row.type as Relationship['type'],
    lastContactAt: row.last_contact_at ? new Date(row.last_contact_at) : null,
    tags: JSON.parse(row.tags),
  };
}
