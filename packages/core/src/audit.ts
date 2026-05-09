import Database from 'better-sqlite3';
import type { SonderEvent, EventFilter } from './types/event.js';

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
        timestamp TEXT NOT NULL,
        validated INTEGER NOT NULL,
        violations TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent ON events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_task ON events(task_id);
      CREATE INDEX IF NOT EXISTS idx_ts ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_validated ON events(validated);
    `);
  }

  write(event: SonderEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (id, agent_id, task_id, timestamp, validated, violations, payload)
      VALUES (@id, @agent_id, @task_id, @timestamp, @validated, @violations, @payload)
    `);
    stmt.run({
      id: event.id,
      agent_id: event.agent_id,
      task_id: event.task_id,
      timestamp: event.timestamp,
      validated: event.governance.validated ? 1 : 0,
      violations: JSON.stringify(event.governance.violations),
      payload: JSON.stringify(event),
    });
  }

  query(filter: EventFilter): SonderEvent[] {
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
      .prepare(`SELECT payload FROM events ${where} ORDER BY timestamp ASC ${limit} ${offset}`)
      .all(params) as Array<{ payload: string }>;

    return rows.map((r) => JSON.parse(r.payload) as SonderEvent);
  }

  close(): void {
    this.db.close();
  }
}
