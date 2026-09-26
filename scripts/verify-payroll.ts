import assert from "node:assert/strict";
import type { Order, SettlementPeriod, SettlementRecord, Worker } from "../lib/club-types";
import {
  DEFAULT_SETTLEMENT_REMINDER_HOURS,
  calculateWorkerEarningForOrder,
  defaultSettlementConfig,
  getOrdersForSettlementPeriod,
  isSettlementOverdue,
  normalizeSettlementIntervalDays,
  normalizeSettlementReminderHours,
} from "../lib/payroll-settlement";

const start = Date.parse("2025-01-01T10:00:00+08:00");
const periodEnd = Date.parse("2025-01-04T20:00:00+08:00");
const worker: Worker = {
  id: "worker-a",
  name: "一号打手",
  gender: "male",
  tier: "1档",
  workerType: "standard",
  order: 0,
  status: "idle",
  total_completed_orders: 1,
  total_tip_earnings: 10,
  joined_at: start,
  settlement_config: {
    interval_days: 3,
    reminder_hours: DEFAULT_SETTLEMENT_REMINDER_HOURS,
  },
  active_period_id: "period-a",
};
const periodA: SettlementPeriod = {
  id: "period-a",
  worker_id: worker.id,
  started_at: start,
  ended_at: null,
  status: "active",
  settlement_record_id: null,
};
const periodB: SettlementPeriod = {
  ...periodA,
  id: "period-b",
  worker_id: "worker-b",
};

assert.deepEqual(defaultSettlementConfig(), {
  interval_days: 3,
  reminder_hours: 72,
});
assert.equal(normalizeSettlementIntervalDays(7), 7);
assert.equal(normalizeSettlementReminderHours(24), 24);
assert.throws(() => normalizeSettlementIntervalDays(0), /结算间隔/);
assert.throws(() => normalizeSettlementReminderHours(0), /待发放提醒/);

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
  worker_order_earnings: { "worker-a": 63, "worker-b": 67.2 },
  worker_tip_earnings: { "worker-a": 10, "worker-b": 0 },
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
    tier_commission_rates: {
      "1档": 25,
      "2档": 20,
      "3档": 15,
      "娱乐陪玩": 10,
    },
    split_type: "equal",
    tiered_ratios: null,
    payout_weights: [
      {
        workerId: "worker-a",
        workerName: "一号打手",
        workerType: "standard",
        tier: "1档",
        weight: 50,
      },
      {
        workerId: "worker-b",
        workerName: "二号打手",
        workerType: "standard",
        tier: "2档",
        weight: 50,
      },
    ],
  },
  settled: false,
  settlement_id: "settlement-a",
  settlement_ids_by_worker: { "worker-a": "settlement-a" },
  settlement_period_id: periodA.id,
  settlement_period_ids_by_worker: {
    "worker-a": periodA.id,
    "worker-b": periodB.id,
  },
};

assert.equal(calculateWorkerEarningForOrder(completedOrder, "worker-a"), 63);
assert.equal(calculateWorkerEarningForOrder(completedOrder, "worker-b"), 67.2);

const legacyCombinedIncomeOrder: Order = {
  ...completedOrder,
  worker_order_earnings: {},
  worker_tip_earnings: {},
};
assert.equal(
  calculateWorkerEarningForOrder(legacyCombinedIncomeOrder, "worker-a"),
  63,
  "旧订单的最终收入需扣除个人打赏后再进入工资周期",
);

// A 已结算后不会重复进入 A 的结算；同一张双人订单仍能进入 B 的独立周期。
assert.equal(
  getOrdersForSettlementPeriod([completedOrder], "worker-a", periodA, periodEnd).length,
  0,
);
assert.equal(
  getOrdersForSettlementPeriod([completedOrder], "worker-b", periodB, periodEnd).length,
  1,
);

const unsettledAtBoundary: Order = {
  ...completedOrder,
  settlement_id: null,
  settlement_ids_by_worker: {},
};
assert.equal(
  getOrdersForSettlementPeriod(
    [unsettledAtBoundary],
    "worker-a",
    periodA,
    periodEnd,
  ).length,
  1,
  "ended_at 边界上的订单必须归入当前周期",
);
assert.equal(
  getOrdersForSettlementPeriod(
    [unsettledAtBoundary],
    "worker-a",
    { ...periodA, id: "another-period" },
    periodEnd,
  ).length,
  0,
  "订单只能归入自己明确关联的周期",
);

const pendingRecord: SettlementRecord = {
  id: "settlement-a",
  period_id: periodA.id,
  worker_id: worker.id,
  worker_name_snapshot: worker.name,
  worker_type_snapshot: worker.workerType,
  period_start: start,
  period_end: periodEnd,
  order_ids: [completedOrder.id],
  order_details: [{
    order_id: completedOrder.id,
    service_name: completedOrder.pricing_snapshot.service_name,
    completed_at: completedOrder.completed_at!,
    worker_amount: 63,
    tip_amount: 10,
  }],
  total_orders: 1,
  total_amount: 63,
  status: "pending",
  paid_at: null,
  note: "",
  created_at: start,
};
assert.equal(
  isSettlementOverdue(pendingRecord, 72, start + 72 * 60 * 60 * 1000 - 1),
  false,
  "提醒阈值前一毫秒不应超期",
);
assert.equal(
  isSettlementOverdue(pendingRecord, 72, start + 72 * 60 * 60 * 1000),
  true,
  "达到 72 小时时应立即显示超期",
);
assert.equal(
  isSettlementOverdue(
    { ...pendingRecord, status: "paid" },
    1,
    start + 100 * 60 * 60 * 1000,
  ),
  false,
  "已发放记录不能继续显示超期",
);

console.log("Payroll verification passed: manual periods, per-worker assignment, boundaries, and reminders.");
