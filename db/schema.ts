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
  orderType: text("order_type").notNull().default("escort"),
  basePriceCents: integer("base_price_cents").notNull(),
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(0),
  commissionMode: text("commission_mode").notNull().default("uniform"),
  clubCommissionBps: integer("club_commission_bps").notNull().default(0),
  tierCommissionRatesJson: text("tier_commission_rates_json")
    .notNull()
    .default('{"1档":0,"2档":0,"3档":0}'),
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
    orderType: text("order_type").notNull().default("escort"),
    hoursHalfUnits: integer("hours_half_units").notNull().default(0),
    hourlyRateSnapshotCents: integer("hourly_rate_snapshot_cents").notNull().default(0),
    splitType: text("split_type").notNull().default("single"),
    status: text("status").notNull(),
    tipCents: integer("tip_cents").notNull().default(0),
    tipsByWorkerJson: text("tips_by_worker_json").notNull().default("{}"),
    finalClubIncomeCents: integer("final_club_income_cents"),
    finalWorkerIncomesJson: text("final_worker_incomes_json").notNull().default("[]"),
    specialRequirementsJson: text("special_requirements_json").notNull().default("[]"),
    basePriceSnapshotCents: integer("base_price_snapshot_cents").notNull().default(0),
    specialTotalCents: integer("special_total_cents").notNull().default(0),
    totalPriceCents: integer("total_price_cents").notNull().default(0),
    orderOriginalTotalCents: integer("order_original_total_cents").notNull().default(0),
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
