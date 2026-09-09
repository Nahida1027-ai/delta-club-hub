import assert from "node:assert/strict";
import type { OrderPricingSnapshot, PayoutWeight } from "../lib/club-types";
import { calculateSettlement } from "../lib/settlement";

function snapshot(
  base: number,
  commission: number,
  weights: PayoutWeight[],
): OrderPricingSnapshot {
  return {
    service_name: "验收场景",
    base_price: base,
    club_commission_rate: commission,
    split_type: weights.length === 1 ? "single" : "equal",
    tiered_ratios: null,
    payout_weights: weights,
  };
}

const worker = (id: string, weight: number): PayoutWeight => ({
  workerId: id,
  workerName: id,
  tier: id === "A" ? "1档" : "2档",
  weight,
});

const cases = [
  {
    name: "single: 打赏免抽成",
    result: calculateSettlement(snapshot(200, 30, [worker("A", 100)]), 20),
    expected: { club: 60, workers: [160] },
  },
  {
    name: "equal: 两人平分",
    result: calculateSettlement(snapshot(200, 10, [worker("A", 50), worker("B", 50)]), 20),
    expected: { club: 20, workers: [100, 100] },
  },
  {
    name: "tiered: 60/40",
    result: calculateSettlement(snapshot(200, 30, [worker("A", 60), worker("B", 40)]), 20),
    expected: { club: 60, workers: [96, 64] },
  },
  {
    name: "equal: 奇数分尾差守恒",
    result: calculateSettlement(snapshot(100.01, 0, [worker("A", 50), worker("B", 50)]), 0),
    expected: { club: 0, workers: [50.01, 50] },
  },
  {
    name: "tiered: 尾差守恒",
    result: calculateSettlement(snapshot(83.33, 0, [worker("A", 60), worker("B", 40)]), 0),
    expected: { club: 0, workers: [50, 33.33] },
  },
  {
    name: "小数抽成",
    result: calculateSettlement(snapshot(10.01, 33.33, [worker("A", 100)]), 0.02),
    expected: { club: 3.34, workers: [6.69] },
  },
  {
    name: "100% 抽成时打赏仍归打手",
    result: calculateSettlement(snapshot(199.99, 100, [worker("A", 100)]), 10.01),
    expected: { club: 199.99, workers: [10.01] },
  },
];

for (const scenario of cases) {
  assert.equal(scenario.result.club_income, scenario.expected.club, scenario.name);
  assert.deepEqual(
    scenario.result.worker_incomes.map((income) => income.amount),
    scenario.expected.workers,
    scenario.name,
  );
  const workerTotal = scenario.result.worker_incomes.reduce((sum, income) => sum + income.amount, 0);
  assert.equal(
    Number((scenario.result.club_income + workerTotal).toFixed(2)),
    scenario.result.total_pool,
    `${scenario.name}: 金额必须守恒`,
  );
}

console.log(`Settlement verification passed: ${cases.length} scenarios.`);

