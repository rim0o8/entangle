import { Database } from 'bun:sqlite';
import type {
  BroadcastProbe,
  BroadcastResponse,
  BroadcastStore,
  IntentStore,
  SealedIntent,
} from './types.ts';

// SQLite-backed stores for intents and broadcast probes.
// Both tables live in the same DB so tryMatch can rely on SQLite's
// transactional semantics without cross-DB coordination.

export function ensureSchema(db: Database): void {
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      owner_person_id TEXT NOT NULL,
      target_person_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      urgency TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      state TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_intents_owner_target
      ON intents(owner_person_id, target_person_id, state);

    CREATE TABLE IF NOT EXISTS probes (
      id TEXT PRIMARY KEY,
      owner_person_id TEXT NOT NULL,
      candidate_person_ids TEXT NOT NULL,
      payload TEXT NOT NULL,
      constraints TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS probe_responses (
      probe_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      response TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      PRIMARY KEY (probe_id, person_id)
    );
  `);
}

// ---- IntentStore ---------------------------------------------------------

interface IntentRow {
  id: string;
  owner_person_id: string;
  target_person_id: string;
  kind: string;
  payload: string;
  urgency: string;
  created_at: number;
  expires_at: number;
  state: string;
}

function rowToIntent(r: IntentRow): SealedIntent {
  return {
    id: r.id,
    ownerPersonId: r.owner_person_id,
    targetPersonId: r.target_person_id,
    kind: r.kind as SealedIntent['kind'],
    payload: r.payload,
    urgency: r.urgency as SealedIntent['urgency'],
    createdAt: new Date(r.created_at),
    expiresAt: new Date(r.expires_at),
    state: r.state as SealedIntent['state'],
  };
}

export class IntentStoreSqlite implements IntentStore {
  private readonly db: Database;
  private readonly stmts: {
    put: ReturnType<Database['prepare']>;
    get: ReturnType<Database['prepare']>;
    findReverse: ReturnType<Database['prepare']>;
    tryMatch: ReturnType<Database['prepare']>;
  };

  constructor(db: Database) {
    ensureSchema(db);
    this.db = db;
    this.stmts = {
      put: db.prepare(
        `INSERT INTO intents
           (id, owner_person_id, target_person_id, kind, payload, urgency, created_at, expires_at, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state=excluded.state`,
      ),
      get: db.prepare('SELECT * FROM intents WHERE id = ?'),
      // counterpart: same two persons in opposite roles, still sealed, not the same row
      findReverse: db.prepare(
        `SELECT * FROM intents
         WHERE owner_person_id = ?
           AND target_person_id = ?
           AND state = 'sealed'
           AND id != ?
           AND expires_at > ?
         ORDER BY created_at ASC
         LIMIT 1`,
      ),
      // Not used; tryMatch runs inline SQL under a transaction for clarity.
      tryMatch: db.prepare('SELECT 1'),
    };
  }

  async put(intent: SealedIntent): Promise<void> {
    this.stmts.put.run(
      intent.id,
      intent.ownerPersonId,
      intent.targetPersonId,
      intent.kind,
      intent.payload,
      intent.urgency,
      intent.createdAt.getTime(),
      intent.expiresAt.getTime(),
      intent.state,
    );
  }

  async get(id: string): Promise<SealedIntent | null> {
    const r = this.stmts.get.get(id) as IntentRow | null;
    return r ? rowToIntent(r) : null;
  }

  async findReverse(intent: SealedIntent): Promise<SealedIntent | null> {
    const r = this.stmts.findReverse.get(
      intent.targetPersonId,
      intent.ownerPersonId,
      intent.id,
      Date.now(),
    ) as IntentRow | null;
    return r ? rowToIntent(r) : null;
  }

  /**
   * Atomic CAS on a pair of intents. The whole thing is one SQLite
   * transaction started with BEGIN IMMEDIATE so concurrent callers
   * serialize on the DB lock. We succeed iff both rows were 'sealed'
   * at the moment the UPDATE ran.
   */
  async tryMatch(idA: string, idB: string): Promise<boolean> {
    const db = this.db;
    try {
      db.exec('BEGIN IMMEDIATE');
      const upd = db
        .prepare(
          `UPDATE intents SET state='matched'
           WHERE id IN (?, ?) AND state='sealed'`,
        )
        .run(idA, idB);
      const changes = Number(upd.changes);
      if (changes === 2) {
        db.exec('COMMIT');
        return true;
      }
      db.exec('ROLLBACK');
      return false;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore secondary rollback failure
      }
      throw err;
    }
  }
}

// ---- BroadcastStore ------------------------------------------------------

interface ProbeRow {
  id: string;
  owner_person_id: string;
  candidate_person_ids: string;
  payload: string;
  constraints: string;
  created_at: number;
}

function rowToProbe(r: ProbeRow): BroadcastProbe {
  return {
    id: r.id,
    ownerPersonId: r.owner_person_id,
    candidatePersonIds: JSON.parse(r.candidate_person_ids),
    payload: r.payload,
    constraints: JSON.parse(r.constraints),
    createdAt: new Date(r.created_at),
  };
}

export class BroadcastStoreSqlite implements BroadcastStore {
  private readonly db: Database;
  private readonly stmts: {
    put: ReturnType<Database['prepare']>;
    get: ReturnType<Database['prepare']>;
    recordResponse: ReturnType<Database['prepare']>;
    listYes: ReturnType<Database['prepare']>;
  };

  constructor(db: Database) {
    ensureSchema(db);
    this.db = db;
    this.stmts = {
      put: db.prepare(
        `INSERT INTO probes (id, owner_person_id, candidate_person_ids, payload, constraints, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      get: db.prepare('SELECT * FROM probes WHERE id = ?'),
      recordResponse: db.prepare(
        `INSERT INTO probe_responses (probe_id, person_id, response, recorded_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(probe_id, person_id) DO UPDATE SET
           response=excluded.response,
           recorded_at=excluded.recorded_at`,
      ),
      listYes: db.prepare(
        "SELECT person_id FROM probe_responses WHERE probe_id = ? AND response = 'yes'",
      ),
    };
  }

  async put(probe: BroadcastProbe): Promise<void> {
    this.stmts.put.run(
      probe.id,
      probe.ownerPersonId,
      JSON.stringify(probe.candidatePersonIds),
      probe.payload,
      JSON.stringify(probe.constraints),
      probe.createdAt.getTime(),
    );
  }

  async get(id: string): Promise<BroadcastProbe | null> {
    const r = this.stmts.get.get(id) as ProbeRow | null;
    return r ? rowToProbe(r) : null;
  }

  async recordResponse(
    probeId: string,
    personId: string,
    response: BroadcastResponse,
  ): Promise<void> {
    this.stmts.recordResponse.run(probeId, personId, response, Date.now());
  }

  async listYes(probeId: string): Promise<string[]> {
    const rows = this.stmts.listYes.all(probeId) as { person_id: string }[];
    return rows.map((r) => r.person_id);
  }
}
