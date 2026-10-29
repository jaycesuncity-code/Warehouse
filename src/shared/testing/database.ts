import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1, Stmt } from '../../../functions/lib/database';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements Stmt {
  args: unknown[] = [];
  constructor(
    readonly owner: TestDatabase,
    readonly sql: string,
  ) {}
  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }
  execute<T>() {
    this.owner.queries.push(this.sql);
    const results = this.owner.sqlite.prepare(this.sql).all(...(this.args as SqlValue[])) as T[];
    this.owner.returnedRows += results.length;
    this.owner.queryResults.push({ sql: this.sql, rows: results.length });
    return { results };
  }
  async all<T>() {
    return this.execute<T>();
  }
  async first<T>() {
    return this.execute<T>().results[0] ?? null;
  }
}

/** Exercises SQL and transaction failures rather than mocking persistence behavior. */
export class TestDatabase implements D1 {
  sqlite = new DatabaseSync(':memory:');
  returnedRows = 0;
  queries: string[] = [];
  queryResults: { sql: string; rows: number }[] = [];
  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    const migrations = new URL('../../../migrations/', import.meta.url);
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .sort())
      this.sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  resetMetrics() {
    this.returnedRows = 0;
    this.queries = [];
    this.queryResults = [];
  }
  prepare(sql: string) {
    return new Statement(this, sql);
  }
  async batch<T>(statements: Stmt[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) => (statement as Statement).execute<T>());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
