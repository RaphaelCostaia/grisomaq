import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("dashboard exposes the executive workspaces and refresh policy", async () => {
  const [dashboard, news, reports] = await Promise.all([
    source("app/home-client.tsx"),
    source("app/noticias/news-client.tsx"),
    source("app/relatorios/reports-client.tsx"),
  ]);

  assert.match(dashboard, /10 \* 60 \* 1000/);
  assert.match(dashboard, /href="\/noticias"/);
  assert.match(dashboard, /\/relatorios\?commodity=/);
  assert.match(news, /href=\{item\.href\}/);
  assert.match(news, /grisomaq-news-favorites/);
  assert.match(reports, /write-excel-file\/browser/);
  assert.match(reports, /jspdf-autotable/);
  assert.match(reports, /grisomaq-report-history/);
});

test("market API uses traceable public inputs and never a fixed price fallback", async () => {
  // A coleta dos indicadores físicos vive em lib/market-collect.ts (compartilhada
  // com o coletor agendado); a rota mantém câmbio, Conab e a resposta ao vivo.
  const [api, collect] = await Promise.all([
    source("app/api/market/route.ts"),
    source("lib/market-collect.ts"),
  ]);

  assert.match(api, /olinda\.bcb\.gov\.br/);
  assert.match(collect, /noticiasagricolas\.com\.br/);
  assert.match(api, /gov\.br\/conab/);
  assert.match(collect, /persistMarketSnapshots/);
  assert.match(api, /s-maxage=600/);
  assert.doesNotMatch(api + collect, /64\.64|140\.63|328\.10|INITIAL_MARKETS|TREND_DATA/);
});

test("snapshot migration preserves a unique observed market record", async () => {
  const migration = await source("drizzle/0000_outgoing_cargill.sql");

  assert.match(migration, /CREATE TABLE `market_snapshots`/);
  assert.match(migration, /`observed_at` text NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX `market_snapshots_commodity_observed_unique`/);
});
