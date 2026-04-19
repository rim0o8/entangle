import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  BroadcastConstraints,
  BroadcastProbe,
  BroadcastResponse,
  BroadcastStore,
  IntentKind,
  IntentState,
  IntentStore,
  SealedIntent,
  Urgency,
} from './types.js';
import {
  BroadcastConstraintsSchema,
  BroadcastResponseSchema,
  IntentKindSchema,
  IntentStateSchema,
  UrgencySchema,
} from './types.js';

export interface StoreOptions {
  dbPath: string;
}

interface IntentRow {
  id: string;
  owner_id: string;
  target_id: string;
  kind: string;
  payload: string;
  urgency: string;
  created_at: number;
  expires_at: number;
  state: string;
}

interface BroadcastRow {
  id: string;
  owner_id: string;
  candidates: string;
  payload: string;
  constraints: string;
  created_at: number;
}

interface ResponseRow {
  probe_id: string;
  person_id: string;
  response: string;
  at: number;
}

function ensureDir(dbPath: string): void {
  const dir = dirname(dbPath);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function openDatabase(dbPath: string): Database.Database {
  ensureDir(dbPath);
  const db = new Database(dbPath);
  // WAL gives multi-process read-safety (§4.5).
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function initIntentSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      urgency TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      state TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_intents_reverse
      ON intents (owner_id, target_id, kind, state);
  `);
}

function initBroadcastSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      candidates TEXT NOT NULL,
      payload TEXT NOT NULL,
      constraints TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS broadcast_responses (
      probe_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      response TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (probe_id, person_id)
    );

    CREATE INDEX IF NOT EXISTS idx_broadcast_responses_probe
      ON broadcast_responses (probe_id);
  `);
}

function hydrateIntent(row: IntentRow): SealedIntent {
  return {
    id: row.id,
    ownerPersonId: row.owner_id,
    targetPersonId: row.target_id,
    kind: IntentKindSchema.parse(row.kind) as IntentKind,
    payload: row.payload,
    urgency: UrgencySchema.parse(row.urgency) as Urgency,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    state: IntentStateSchema.parse(row.state) as IntentState,
  };
}

function hydrateBroadcast(row: BroadcastRow, responseRows: ResponseRow[]): BroadcastProbe {
  const candidateIdsRaw = JSON.parse(row.candidates) as unknown;
  if (!Array.isArray(candidateIdsRaw)) {
    throw new Error(`broadcast.candidates malformed for ${row.id}`);
  }
  const candidatePersonIds = candidateIdsRaw.map((v) => String(v));
  const constraintsRaw = JSON.parse(row.constraints) as unknown;
  const constraints: BroadcastConstraints = BroadcastConstraintsSchema.parse(constraintsRaw);
  const responses: Record<string, BroadcastResponse> = {};
  for (const id of candidatePersonIds) {
    responses[id] = 'silent';
  }
  for (const r of responseRows) {
    responses[r.person_id] = BroadcastResponseSchema.parse(r.response);
  }
  return {
    id: row.id,
    ownerPersonId: row.owner_id,
    candidatePersonIds,
    payload: row.payload,
    constraints,
    createdAt: new Date(row.created_at),
    responses,
  };
}

export function createIntentStore(options: StoreOptions): IntentStore {
  const db = openDatabase(options.dbPath);
  initIntentSchema(db);

  const putStmt = db.prepare(
    `INSERT INTO intents (id, owner_id, target_id, kind, payload, urgency, created_at, expires_at, state)
     VALUES (@id, @owner_id, @target_id, @kind, @payload, @urgency, @created_at, @expires_at, @state)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id,
       target_id = excluded.target_id,
       kind = excluded.kind,
       payload = excluded.payload,
       urgency = excluded.urgency,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at,
       state = excluded.state`
  );

  const getStmt = db.prepare(
    'SELECT id, owner_id, target_id, kind, payload, urgency, created_at, expires_at, state FROM intents WHERE id = ?'
  );

  const setStateStmt = db.prepare('UPDATE intents SET state = ? WHERE id = ?');

  const findReverseStmt = db.prepare(
    `SELECT id, owner_id, target_id, kind, payload, urgency, created_at, expires_at, state
     FROM intents
     WHERE owner_id = ? AND target_id = ? AND kind = ? AND state = 'sealed'
     ORDER BY created_at ASC
     LIMIT 1`
  );

  const put = async (intent: SealedIntent): Promise<void> => {
    putStmt.run({
      id: intent.id,
      owner_id: intent.ownerPersonId,
      target_id: intent.targetPersonId,
      kind: intent.kind,
      payload: intent.payload,
      urgency: intent.urgency,
      created_at: intent.createdAt.getTime(),
      expires_at: intent.expiresAt.getTime(),
      state: intent.state,
    });
  };

  const get = async (id: string): Promise<SealedIntent | null> => {
    const row = getStmt.get(id) as IntentRow | undefined;
    return row ? hydrateIntent(row) : null;
  };

  const findReverse = async (intent: SealedIntent): Promise<SealedIntent | null> => {
    // Reverse = counterpart whose owner/target is the swap of this intent's.
    const row = findReverseStmt.get(intent.targetPersonId, intent.ownerPersonId, intent.kind) as
      | IntentRow
      | undefined;
    return row ? hydrateIntent(row) : null;
  };

  const setState = async (id: string, state: SealedIntent['state']): Promise<void> => {
    const result = setStateStmt.run(state, id);
    if (result.changes === 0) {
      throw new Error(`intent not found: ${id}`);
    }
  };

  return { put, get, findReverse, setState };
}

export function createBroadcastStore(options: StoreOptions): BroadcastStore {
  const db = openDatabase(options.dbPath);
  initBroadcastSchema(db);

  const putStmt = db.prepare(
    `INSERT INTO broadcasts (id, owner_id, candidates, payload, constraints, created_at)
     VALUES (@id, @owner_id, @candidates, @payload, @constraints, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id,
       candidates = excluded.candidates,
       payload = excluded.payload,
       constraints = excluded.constraints,
       created_at = excluded.created_at`
  );

  const getStmt = db.prepare(
    'SELECT id, owner_id, candidates, payload, constraints, created_at FROM broadcasts WHERE id = ?'
  );

  const getResponsesStmt = db.prepare(
    'SELECT probe_id, person_id, response, at FROM broadcast_responses WHERE probe_id = ?'
  );

  const upsertResponseStmt = db.prepare(
    `INSERT INTO broadcast_responses (probe_id, person_id, response, at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(probe_id, person_id) DO UPDATE SET
       response = excluded.response,
       at = excluded.at`
  );

  const put = async (probe: BroadcastProbe): Promise<void> => {
    const tx = db.transaction((p: BroadcastProbe) => {
      putStmt.run({
        id: p.id,
        owner_id: p.ownerPersonId,
        candidates: JSON.stringify(p.candidatePersonIds),
        payload: p.payload,
        constraints: JSON.stringify(p.constraints),
        created_at: p.createdAt.getTime(),
      });
      const now = Date.now();
      for (const [personId, response] of Object.entries(p.responses)) {
        if (response !== 'silent') {
          upsertResponseStmt.run(p.id, personId, response, now);
        }
      }
    });
    tx(probe);
  };

  const get = async (id: string): Promise<BroadcastProbe | null> => {
    const row = getStmt.get(id) as BroadcastRow | undefined;
    if (!row) return null;
    const responseRows = getResponsesStmt.all(id) as ResponseRow[];
    return hydrateBroadcast(row, responseRows);
  };

  const recordResponse = async (
    probeId: string,
    personId: string,
    response: 'yes' | 'no' | 'silent'
  ): Promise<void> => {
    const probeRow = getStmt.get(probeId) as BroadcastRow | undefined;
    if (!probeRow) throw new Error(`probe not found: ${probeId}`);
    upsertResponseStmt.run(probeId, personId, response, Date.now());
  };

  return { put, get, recordResponse };
}
