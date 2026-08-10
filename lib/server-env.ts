// Adaptador de banco para rodar fora da Cloudflare (VPS/Node).
// Expõe `env.DB` com a MESMA API do Cloudflare D1 (prepare/bind/run/all/first/
// batch, assíncronos), backed por SQLite local via better-sqlite3 — assim os
// módulos db/market.ts e db/auth.ts não precisam mudar as queries.
//
// IMPORTANTE: o `prepare` é preguiçoso (compila o SQL só na hora de executar),
// igual ao D1. O better-sqlite3 valida o SQL já no prepare; se compilássemos
// cedo, um "CREATE INDEX ... ON sessions" dentro de um batch falharia antes de
// a tabela existir.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Row = Record<string, unknown>;

let sqlite: Database.Database | null = null;

function db(): Database.Database {
  if (sqlite) return sqlite;
  const path = resolve(process.env.GRISOMAQ_DB_PATH ?? "./data/grisomaq.db");
  mkdirSync(dirname(path), { recursive: true });
  sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

class D1Statement {
  private readonly sql: string;
  private args: unknown[] = [];

  constructor(sql: string) {
    this.sql = sql;
  }

  bind(...args: unknown[]) {
    // better-sqlite3 não aceita `undefined` como parâmetro.
    this.args = args.map((value) => (value === undefined ? null : value));
    return this;
  }

  runSync() {
    return db().prepare(this.sql).run(...this.args);
  }

  async run() {
    const info = this.runSync();
    return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }

  async all<T = Row>() {
    return { results: db().prepare(this.sql).all(...this.args) as T[], success: true };
  }

  async first<T = Row>() {
    return (db().prepare(this.sql).get(...this.args) as T | undefined) ?? null;
  }
}

const D1 = {
  prepare(sql: string) {
    return new D1Statement(sql);
  },
  async batch(statements: D1Statement[]) {
    const run = db().transaction((list: D1Statement[]) => {
      for (const statement of list) statement.runSync();
    });
    run(statements);
    return statements.map(() => ({ success: true }));
  },
};

export const env = { DB: D1 };
