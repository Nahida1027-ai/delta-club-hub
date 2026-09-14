// Intentionally empty by default.
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workers = sqliteTable("workers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: text("tier").notNull(),
  workerType: text("worker_type").notNull().default("standard"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("idle"),
  totalCompletedOrders: integer("total_completed_orders").notNull().default(0),
  joinedAt: integer("joined_at").notNull().default(0),
  settlementIntervalDays: integer("settlement_interval_days").notNull().default(3),
  settlementTime: text("settlement_time").notNull().default("20:00"),
  lastSettledAt: integer("last_settled_at"),
  nextSettlementAt: integer("next_settlement_at"),
});

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_folders_parent_order").on(table.parentId, table.sortOrder)],
);

export const priceMenu = sqliteTable("price_menu", {
  id: text("id").primaryKey(),
  serviceName: text("service_name").notNull(),
  folderId: text("folder_id"),
  sortOrder: integer("sort_order").notNull().default(0),
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
    settled: integer("settled").notNull().default(0),
    settlementId: text("settlement_id"),
    settlementIdsByWorkerJson: text("settlement_ids_by_worker_json")
      .notNull()
      .default("{}"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_orders_status").on(table.status),
    index("idx_orders_completed_at").on(table.completedAt),
  ],
);

export const settlementRecords = sqliteTable(
  "settlement_records",
  {
    id: text("id").primaryKey(),
    workerId: text("worker_id").notNull(),
    workerNameSnapshot: text("worker_name_snapshot").notNull(),
    workerTypeSnapshot: text("worker_type_snapshot").notNull().default("standard"),
    periodStart: integer("period_start").notNull(),
    periodEnd: integer("period_end").notNull(),
    orderIdsJson: text("order_ids_json").notNull().default("[]"),
    orderDetailsJson: text("order_details_json").notNull().default("[]"),
    totalOrders: integer("total_orders").notNull().default(0),
    totalAmountCents: integer("total_amount_cents").notNull().default(0),
    status: text("status").notNull().default("pending"),
    paidAt: integer("paid_at"),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_settlement_records_status_end").on(table.status, table.periodEnd),
    index("idx_settlement_records_worker_status").on(table.workerId, table.status),
    uniqueIndex("idx_settlement_records_worker_period").on(
      table.workerId,
      table.periodEnd,
    ),
  ],
);
export {};
