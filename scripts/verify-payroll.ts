import assert from "node:assert/strict";
import type { Order, Worker } from "../lib/club-types";
import {
  calculateNextSettlementTime,
  calculateWorkerEarningForOrder,
  getOrdersInPeriod,
} from "../lib/payroll-settlement";

const start = Date.parse("2025-01-01T10:00:00+08:00");
const periodEnd = Date.parse("2025-01-04T20:00:00+08:00");
const worker: Worker = {
  id: "worker-a",
  name: "一号打手",
  tier: "1档",
  workerType: "standard",
  order: 0,
  status: "idle",
  total_completed_orders: 1,
  joined_at: start,
  settlement_config: {
    interval_days: 3,
    settlement_time: "20:00",
    last_settled_at: null,
    next_settlement_at: null,
  },
};

assert.equal(calculateNextSettlementTime(worker), periodEnd);

const completedOrder: Order = {
  id: "order-boundary",
  menu_item_id: "menu-1",
  assigned_worker_ids: ["worker-a", "worker-b"],
  order_type: "escort",
  hours: null,
  hourly_rate_snapshot: null,
  split_type: "equal",
  status: "completed",
  tip: 10,
  tips_by_worker: { "worker-a": 10, "worker-b": 0 },
  final_club_income: 37.8,
  final_worker_incomes: [
    { workerId: "worker-a", amount: 73 },
    { workerId: "worker-b", amount: 67.2 },
  ],
  special_requirements: [],
  base_price_snapshot: 168,
  special_total: 0,
  total_price: 168,
  order_original_total: 168,
  created_at: "2025-01-01T02:00:00.000Z",
  completed_at: new Date(periodEnd).toISOString(),
  pricing_snapshot: {
    service_name: "双人护航",
    order_type: "escort",
    hourly_rate: 0,
    base_price: 168,
    commission_mode: "by_tier",
    club_commission_rate: 0,
    tier_commission_rates: { "1档": 25, "2档": 20, "3档": 15 },
    split_type: "equal",
    tiered_ratios: null,
    payout_weights: [
      { workerId: "worker-a", workerName: "一号打手", tier: "1档", weight: 50 },
      { workerId: "worker-b", workerName: "二号打手", tier: "2档", weight: 50 },
    ],
  },
  settled: false,
  settlement_id: "settlement-a",
  settlement_ids_by_worker: { "worker-a": "settlement-a" },
};

assert.equal(calculateWorkerEarningForOrder(completedOrder, "worker-a"), 73);
assert.equal(calculateWorkerEarningForOrder(completedOrder, "worker-b"), 67.2);

// A 已归批后不会再次进入 A 的结算，但同一双人订单仍可进入 B 的独立周期。
assert.equal(getOrdersInPeriod([completedOrder], "worker-a", start, periodEnd).length, 0);
assert.equal(getOrdersInPeriod([completedOrder], "worker-b", start, periodEnd).length, 1);

const unsettledAtBoundary = {
  ...completedOrder,
  settlement_id: null,
  settlement_ids_by_worker: {},
};
assert.equal(
  getOrdersInPeriod([unsettledAtBoundary], "worker-a", start, periodEnd).length,
  1,
  "period_end 边界上的订单必须归入本批次",
);

console.log("Payroll settlement checks passed.");
