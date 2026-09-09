// Intentionally empty by default.
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workers = sqliteTable("workers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: text("tier").notNull(),
  status: text("status").notNull().default("idle"),
  totalCompletedOrders: integer("total_completed_orders").notNull().default(0),
});

export const priceMenu = sqliteTable("price_menu", {
  id: text("id").primaryKey(),
  serviceName: text("service_name").notNull(),
  basePriceCents: integer("base_price_cents").notNull(),
  clubCommissionBps: integer("club_commission_bps").notNull().default(0),
  splitType: text("split_type").notNull(),
  tieredRatiosJson: text("tiered_ratios_json"),
  eligibleTiersJson: text("eligible_tiers_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    menuItemId: text("menu_item_id").notNull(),
    assignedWorkerIdsJson: text("assigned_worker_ids_json").notNull(),
    status: text("status").notNull(),
    tipCents: integer("tip_cents").notNull().default(0),
    finalClubIncomeCents: integer("final_club_income_cents"),
    finalWorkerIncomesJson: text("final_worker_incomes_json").notNull().default("[]"),
    pricingSnapshotJson: text("pricing_snapshot_json").notNull(),
    settlementToken: text("settlement_token"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_orders_status").on(table.status),
    index("idx_orders_completed_at").on(table.completedAt),
  ],
);
export {};
