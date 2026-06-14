import Database from 'better-sqlite3';
import type {
  SonderEvent,
  SonderEventAny,
  SonderEventV2,
  EventFilter,
} from './types/event.js';

export interface AuditLogReadFilter {
  agent_id?: string;
  task_id?: string;
  from?: string;
  to?: string;
  validated?: boolean;
  limit?: number;
  offset?: number;
}

export interface GenesisRow {
  agent_id: string;
  genesis_event_id: string;
  genesis_timestamp: string;
}

/**
 * SQLite-backed audit log. Persists v1 and v2 events; surfaces helpers
 * for chain operations (latest hash, genesis read/write, IMMEDIATE-tx
 * chain write).
 */
export class AuditLog {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        parent_id TEXT,
        timestamp TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1',
        validated INTEGER NOT NULL,
        violations TEXT NOT NULL,
        chain_prev_hash TEXT,
        chain_self_hash TEXT,
        signature TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent ON events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_task ON events(task_id);
      CREATE INDEX IF NOT EXISTS idx_parent ON events(parent_id);
      CREATE INDEX IF NOT EXISTS idx_ts ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_validated ON events(validated);
      CREATE INDEX IF NOT EXISTS idx_agent_ts ON events(agent_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_chain_self ON events(chain_self_hash);
      CREATE INDEX IF NOT EXISTS idx_chain_prev ON events(chain_prev_hash);

      CREATE TABLE IF NOT EXISTS chain_genesis (
        agent_id TEXT PRIMARY KEY,
        genesis_event_id TEXT NOT NULL,
        genesis_timestamp TEXT NOT NULL
      );
    `);
    this.migrateLegacySchema();
  }

  /**
   * Backfill the v2 columns on any pre-v2 events table created before this
   * change set landed. Idempotent — ALTER TABLE failures (column-already-
   * exists) are swallowed.
   */
  private migrateLegacySchema(): void {
    const cols = this.db.prepare(`PRAGMA table_info(events)`).all() as Array<{
      name: string;
    }>;
    const has = (name: string) => cols.some((c) => c.name === name);
    const add = (sql: string) => {
      try {
        this.db.exec(sql);
      } catch {
        /* column already exists */
      }
    };
    if (!has('version')) add(`ALTER TABLE events ADD COLUMN version TEXT NOT NULL DEFAULT '1'`);
    if (!has('chain_prev_hash')) add(`ALTER TABLE events ADD COLUMN chain_prev_hash TEXT`);
    if (!has('chain_self_hash')) add(`ALTER TABLE events ADD COLUMN chain_self_hash TEXT`);
    if (!has('signature')) add(`ALTER TABLE events ADD COLUMN signature TEXT`);
    // Phase 3.5 — parent_id causal DAG column + index for descendant traversal.
    if (!has('parent_id')) add(`ALTER TABLE events ADD COLUMN parent_id TEXT`);
    add(`CREATE INDEX IF NOT EXISTS idx_parent ON events(parent_id)`);
  }

  /**
   * Insert an event row. Callers should use `writeChain` to write v2 events
   * under the IMMEDIATE-tx serialization invariant; `write` is retained for
   * v1 back-compat callers and tests.
   */
  write(event: SonderEventAny): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, agent_id, task_id, parent_id, timestamp, version,
        validated, violations,
        chain_prev_hash, chain_self_hash, signature,
        payload
      )
      VALUES (
        @id, @agent_id, @task_id, @parent_id, @timestamp, @version,
        @validated, @violations,
        @chain_prev_hash, @chain_self_hash, @signature,
        @payload
      )
    `);
    stmt.run({
      id: event.id,
      agent_id: event.agent_id,
      task_id: event.task_id,
      parent_id: event.parent_id ?? null,
      timestamp: event.timestamp,
      version: event.version,
      validated: event.governance.validated ? 1 : 0,
      violations: JSON.stringify(event.governance.violations),
      chain_prev_hash: event.version === '2' ? event.chain_prev_hash : null,
      chain_self_hash: event.version === '2' ? event.chain_self_hash : null,
      signature: event.version === '2' ? event.signature : null,
      payload: JSON.stringify(event),
    });
  }

  /**
   * Read the head event for an agent. Returns null when the agent has no
   * v2 events on file. Used by the chain-write helper to derive
   * `chain_prev_hash`.
   */
  readLatestHash(agent_id: string): string | null {
    const row = this.db
      .prepare(
        `SELECT chain_self_hash FROM events
         WHERE agent_id = ? AND version = '2'
         ORDER BY timestamp DESC, id DESC
         LIMIT 1`,
      )
      .get(agent_id) as { chain_self_hash: string | null } | undefined;
    return row?.chain_self_hash ?? null;
  }

  /** Read the genesis tuple for an agent. Null when no genesis is recorded yet. */
  readGenesis(agent_id: string): GenesisRow | null {
    const row = this.db
      .prepare(
        `SELECT agent_id, genesis_event_id, genesis_timestamp
         FROM chain_genesis WHERE agent_id = ?`,
      )
      .get(agent_id) as GenesisRow | undefined;
    return row ?? null;
  }

  /**
   * Run a function in an IMMEDIATE SQLite transaction. Used by the chain
   * writer to serialize per-agent writes (Spec 2 R6).
   */
  immediate<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return tx.immediate();
  }

  /**
   * Write a v2 event together with its genesis row (if first event for the
   * agent). MUST be called inside `immediate()`.
   */
  writeChain(event: SonderEventV2): void {
    const existing = this.readGenesis(event.agent_id);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO chain_genesis (agent_id, genesis_event_id, genesis_timestamp)
           VALUES (?, ?, ?)`,
        )
        .run(event.agent_id, event.id, event.timestamp);
    }
    this.write(event);
  }

  /**
   * Query events. Returns both v1 and v2 rows (typed by `version`).
   * `verify-chain` is responsible for skipping v1 rows.
   */
  query(filter: EventFilter): SonderEventAny[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.agent_id) {
      conditions.push('agent_id = @agent_id');
      params['agent_id'] = filter.agent_id;
    }
    if (filter.task_id) {
      conditions.push('task_id = @task_id');
      params['task_id'] = filter.task_id;
    }
    if (filter.parent_id) {
      conditions.push('parent_id = @parent_id');
      params['parent_id'] = filter.parent_id;
    }
    if (filter.from) {
      conditions.push('timestamp >= @from');
      params['from'] = filter.from;
    }
    if (filter.to) {
      conditions.push('timestamp <= @to');
      params['to'] = filter.to;
    }
    if (filter.validated !== undefined) {
      conditions.push('validated = @validated');
      params['validated'] = filter.validated ? 1 : 0;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ? `LIMIT ${filter.limit}` : '';
    const offset = filter.offset ? `OFFSET ${filter.offset}` : '';

    const rows = this.db
      .prepare(`SELECT payload FROM events ${where} ORDER BY timestamp ASC, id ASC ${limit} ${offset}`)
      .all(params) as Array<{ payload: string }>;

    return rows.map((r) => JSON.parse(r.payload) as SonderEventAny);
  }

  /**
   * Walk an agent's events in `timestamp ASC, id ASC` order. Used by the
   * verifier. Mixed v1/v2 returns are surfaced as-is; the caller is
   * responsible for skipping v1.
   */
  queryByAgent(agent_id: string, opts: { from?: string; limit?: number } = {}): SonderEventAny[] {
    const filter: EventFilter = { agent_id };
    if (opts.from !== undefined) filter.from = opts.from;
    if (opts.limit !== undefined) filter.limit = opts.limit;
    return this.query(filter);
  }

  /**
   * Direct children of an event (parent_id = id). Phase 3.5 — the single-hop
   * causal lookup used by the Aegis label extractor to find veto/outcome/
   * downstream events that chain to a decision event. Returns rows in
   * `timestamp ASC, id ASC` order.
   */
  queryChildren(parent_id: string): SonderEventAny[] {
    return this.query({ parent_id });
  }

  /**
   * Recursively walk the causal DAG rooted at `rootId`, returning every
   * descendant (children, grandchildren, ...) in breadth-first order.
   * Phase 3.5 — backs `downstream_error` / rollback detection where a
   * failure can be several causal hops removed from the decision event.
   *
   * The root event itself is NOT included. Cycle-safe via a visited set
   * (the signed chain should be acyclic, but the guard is cheap insurance).
   * `opts.maxDepth` caps traversal depth (default: unbounded).
   */
  queryDescendants(rootId: string, opts: { maxDepth?: number } = {}): SonderEventAny[] {
    const maxDepth = opts.maxDepth ?? Infinity;
    const out: SonderEventAny[] = [];
    const visited = new Set<string>([rootId]);
    let frontier: string[] = [rootId];
    let depth = 0;

    while (frontier.length > 0 && depth < maxDepth) {
      const next: string[] = [];
      for (const parentId of frontier) {
        const children = this.queryChildren(parentId);
        for (const child of children) {
          if (visited.has(child.id)) continue;
          visited.add(child.id);
          out.push(child);
          next.push(child.id);
        }
      }
      frontier = next;
      depth += 1;
    }

    return out;
  }

  /**
   * Distinct agents with at least one v2 event. Used by the anchor builder
   * to enumerate chain heads.
   */
  listV2Agents(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT agent_id FROM events WHERE version = '2' ORDER BY agent_id`)
      .all() as Array<{ agent_id: string }>;
    return rows.map((r) => r.agent_id);
  }

  /**
   * Head event for an agent (latest v2 row). Returns null when the agent
   * has no v2 events. Used by the anchor builder.
   */
  readHeadEvent(agent_id: string): SonderEventV2 | null {
    const row = this.db
      .prepare(
        `SELECT payload FROM events
         WHERE agent_id = ? AND version = '2'
         ORDER BY timestamp DESC, id DESC
         LIMIT 1`,
      )
      .get(agent_id) as { payload: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.payload) as SonderEventV2;
  }

  /**
   * Raw DB handle escape hatch — used by the verifier CLI to issue
   * arbitrary read queries without re-implementing them here. The
   * AuditLog otherwise owns its connection.
   */
  rawDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
