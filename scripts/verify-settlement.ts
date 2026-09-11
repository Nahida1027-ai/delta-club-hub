import assert from "node:assert/strict";
import type {
  CommissionMode,
  OrderPricingSnapshot,
  PayoutWeight,
  SplitType,
  TierCommissionRates,
  TieredRatios,
  WorkerTier,
} from "../lib/club-types";
import {
  calculateSettlement,
  normalizeSpecialRequirements,
  specialRequirementsTotal,
} from "../lib/settlement";

const zeroTierRates: TierCommissionRates = {
  "1档": 0,
  "2档": 0,
  "3档": 0,
};

interface SnapshotOptions {
  commissionMode?: CommissionMode;
  tierRates?: TierCommissionRates;
  splitType?: SplitType;
  tieredRatios?: TieredRatios | null;
}

function snapshot(
  base: number,
  commission: number,
  weights: PayoutWeight[],
  options: SnapshotOptions = {},
): OrderPricingSnapshot {
  return {
    service_name: "验收场景",
    base_price: base,
    commission_mode: options.commissionMode ?? "uniform",
    club_commission_rate: commission,
    tier_commission_rates: options.tierRates ?? zeroTierRates,
    split_type: options.splitType ?? (weights.length === 1 ? "single" : "equal"),
    tiered_ratios: options.tieredRatios ?? null,
    payout_weights: weights,
  };
}

const worker = (
  id: string,
  weight: number,
  tier: WorkerTier = id === "A" ? "1档" : "2档",
): PayoutWeight => ({
  workerId: id,
  workerName: id,
  tier,
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
  {
    name: "uniform: 特殊需求参与抽成，打赏免抽成",
    result: calculateSettlement(snapshot(100, 10, [worker("A", 100)]), 20, 130),
    expected: { club: 13, workers: [137] },
  },
  {
    name: "by-tier single: 使用接单打手档位抽成",
    result: calculateSettlement(
      snapshot(100, 0, [worker("A", 100)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 10, "2档": 15, "3档": 20 },
      }),
      0,
      130,
    ),
    expected: { club: 13, workers: [117] },
  },
  {
    name: "by-tier equal: 两名打手分别按整单金额抽成后平分",
    result: calculateSettlement(
      snapshot(100, 0, [worker("A", 50), worker("B", 50)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 10, "2档": 20, "3档": 0 },
      }),
      0,
      130,
    ),
    expected: { club: 39, workers: [45.5, 45.5] },
  },
  {
    name: "by-tier tiered: 先扣档位抽成再按 60/40 分配",
    result: calculateSettlement(
      snapshot(100, 0, [worker("A", 60), worker("B", 40)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 10, "2档": 20, "3档": 0 },
        splitType: "tiered",
        tieredRatios: { "1档": 60, "2档": 40 },
      }),
      0,
      130,
    ),
    expected: { club: 39, workers: [54.6, 36.4] },
  },
  {
    name: "by-tier equal: 两名同档打手分别承担该档位抽成",
    result: calculateSettlement(
      snapshot(
        100,
        0,
        [worker("B", 50, "2档"), worker("C", 50, "2档")],
        {
          commissionMode: "by_tier",
          tierRates: { "1档": 0, "2档": 15, "3档": 0 },
        },
      ),
      0,
    ),
    expected: { club: 30, workers: [35, 35] },
  },
  {
    name: "by-tier 100% 边界: 打赏仍完整进入打手池",
    result: calculateSettlement(
      snapshot(100, 0, [worker("A", 50), worker("B", 50)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 40, "2档": 60, "3档": 0 },
      }),
      10,
    ),
    expected: { club: 100, workers: [5, 5] },
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

assert.throws(
  () =>
    calculateSettlement(
      snapshot(100, 0, [worker("A", 50), worker("B", 50)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 60, "2档": 50, "3档": 0 },
      }),
      0,
    ),
  /档位抽成合计不能超过 100%/,
  "by-tier: 合计抽成超过 100% 必须拒绝",
);

const normalizedRequirements = normalizeSpecialRequirements([
  { name: "  指定英雄  ", price: 0 },
  { name: "通宵加班", price: 30.005 },
]);
assert.deepEqual(
  normalizedRequirements,
  [
    { name: "指定英雄", price: 0 },
    { name: "通宵加班", price: 30.01 },
  ],
  "特殊需求应修剪名称并按分精度归一化",
);
assert.equal(
  specialRequirementsTotal(normalizedRequirements),
  30.01,
  "特殊需求金额必须使用整数分求和",
);
assert.throws(
  () => normalizeSpecialRequirements([{ name: "   ", price: 10 }]),
  /特殊需求名称/,
  "特殊需求名称不能为空",
);
assert.throws(
  () => normalizeSpecialRequirements([{ name: "指定英雄", price: -0.01 }]),
  /金额必须是非负数字/,
  "特殊需求加价不能为负数",
);

console.log(
  `Settlement verification passed: ${cases.length} settlement scenarios + 5 validation assertions.`,
);
