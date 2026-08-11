import { env } from "../lib/server-env";
import { ptDateToIso } from "../lib/market-parsers";
import type { CommodityId, MarketItem, MarketPoint } from "../lib/market-types";

let initialized = false;

async function ensureMarketTables() {
  if (initialized || !env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commodity TEXT NOT NULL,
      value REAL NOT NULL,
      change REAL,
      unit TEXT NOT NULL,
      source TEXT NOT NULL,
      provider TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      collected_at TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS market_snapshots_commodity_observed_unique ON market_snapshots (commodity, observed_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS market_snapshots_commodity_observed_idx ON market_snapshots (commodity, observed_at)"),
  ]);
  initialized = true;
}

export async function persistMarketSnapshots(markets: MarketItem[], collectedAt: string) {
  if (!env.DB) return;
  await ensureMarketTables();
  const statements: ReturnType<typeof env.DB.prepare>[] = [];
  for (const market of markets) {
    if (market.value === null || market.status === "unavailable") continue;
    // Persiste a JANELA inteira devolvida pela fonte (não só o último fechamento),
    // para o histórico acumular mesmo com acesso esporádico. O índice único
    // (commodity, observed_at) + INSERT OR IGNORE evita duplicar o mesmo dia.
    const points = market.history.length
      ? market.history.map((point) => ({
          observedAt: point.date.includes("/") ? ptDateToIso(point.date) : point.date,
          value: point.value,
          change: point.change,
        }))
      : market.observedAt
        ? [{ observedAt: market.observedAt, value: market.value, change: market.change }]
        : [];
    for (const point of points) {
      if (point.value === null || !point.observedAt) continue;
      statements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO market_snapshots
          (commodity, value, change, unit, source, provider, observed_at, collected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        market.id,
        point.value,
        point.change,
        market.unit,
        market.source,
        market.provider,
        point.observedAt,
        collectedAt,
      ));
    }
  }

  if (statements.length) await env.DB.batch(statements);
  await env.DB.prepare("DELETE FROM market_snapshots WHERE collected_at < datetime('now', '-400 days')").run();
}

export async function readStoredHistory(commodity: CommodityId, limit = 180): Promise<MarketPoint[]> {
  if (!env.DB) return [];
  await ensureMarketTables();
  const result = await env.DB.prepare(
    `SELECT observed_at AS date, value, change
     FROM market_snapshots
     WHERE commodity = ?
     ORDER BY observed_at DESC
     LIMIT ?`,
  ).bind(commodity, limit).all<{ date: string; value: number; change: number | null }>();

  return result.results.map((row) => ({ date: row.date, value: row.value, change: row.change }));
}
