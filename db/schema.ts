import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const marketSnapshots = sqliteTable(
  "market_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    commodity: text("commodity").notNull(),
    value: real("value").notNull(),
    change: real("change"),
    unit: text("unit").notNull(),
    source: text("source").notNull(),
    provider: text("provider").notNull(),
    observedAt: text("observed_at").notNull(),
    collectedAt: text("collected_at").notNull(),
  },
  (table) => [
    uniqueIndex("market_snapshots_commodity_observed_unique").on(table.commodity, table.observedAt),
    index("market_snapshots_commodity_observed_idx").on(table.commodity, table.observedAt),
  ],
);
