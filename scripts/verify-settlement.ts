import assert from "node:assert/strict";
import type {
  CommissionMode,
  Order,
  OrderPricingSnapshot,
  PayoutWeight,
  SplitType,
  TierCommissionRates,
  TieredRatios,
  WorkerTier,
} from "../lib/club-types";
import {
  calculateOrderBasePrice,
  calculateSettlement,
  normalizeCompanionHours,
  normalizeSpecialRequirements,
  resolveOrderTipsByWorker,
  specialRequirementsTotal,
} from "../lib/settlement";

const zeroTierRates: TierCommissionRates = {
  "1档": 0,
  "2档": 0,
  "3档": 0,
  "娱乐陪玩": 0,
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
    order_type: "escort",
    hourly_rate: 0,
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
  workerType: "standard",
  tier,
  weight,
});

const cases = [
  {
    name: "single: 个人打赏免抽成",
    result: calculateSettlement(snapshot(200, 30, [worker("A", 100)]), { A: 20 }),
    expected: { club: 60, workers: [160] },
  },
  {
    name: "equal: 兼容相同的个人打赏",
    result: calculateSettlement(snapshot(200, 10, [worker("A", 50), worker("B", 50)]), { A: 10, B: 10 }),
    expected: { club: 20, workers: [100, 100] },
  },
  {
    name: "tiered: 个人打赏互不影响",
    result: calculateSettlement(snapshot(200, 30, [worker("A", 60), worker("B", 40)]), { A: 12, B: 8 }),
    expected: { club: 60, workers: [96, 64] },
  },
  {
    name: "equal: 奇数分尾差守恒",
    result: calculateSettlement(snapshot(100.01, 0, [worker("A", 50), worker("B", 50)]), {}),
    expected: { club: 0, workers: [50.01, 50] },
  },
  {
    name: "tiered: 尾差守恒",
    result: calculateSettlement(snapshot(83.33, 0, [worker("A", 60), worker("B", 40)]), {}),
    expected: { club: 0, workers: [50, 33.33] },
  },
  {
    name: "小数抽成",
    result: calculateSettlement(snapshot(10.01, 33.33, [worker("A", 100)]), { A: 0.02 }),
    expected: { club: 3.34, workers: [6.69] },
  },
  {
    name: "100% 抽成时打赏仍归打手",
    result: calculateSettlement(snapshot(199.99, 100, [worker("A", 100)]), { A: 10.01 }),
    expected: { club: 199.99, workers: [10.01] },
  },
  {
    name: "uniform: 特殊需求参与抽成，打赏免抽成",
    result: calculateSettlement(snapshot(100, 10, [worker("A", 100)]), { A: 20 }, 130),
    expected: { club: 13, workers: [137] },
  },
  {
    name: "by-tier single: 使用接单打手档位抽成",
    result: calculateSettlement(
      snapshot(100, 0, [worker("A", 100)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 10, "2档": 15, "3档": 20, "娱乐陪玩": 0 },
      }),
      {},
      130,
    ),
    expected: { club: 13, workers: [117] },
  },
  {
    name: "by-tier equal: 两名打手分别按自己的半份金额抽成",
    result: calculateSettlement(
      snapshot(100, 0, [worker("A", 50), worker("B", 50)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 10, "2档": 20, "3档": 0, "娱乐陪玩": 0 },
      }),
      {},
      130,
    ),
    expected: { club: 19.5, workers: [58.5, 52] },
  },
  {
    name: "by-tier tiered: 旧档位模式按各自冻结份额独立抽成",
    result: calculateSettlement(
      snapshot(100, 0, [worker("A", 60), worker("B", 40)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 10, "2档": 20, "3档": 0, "娱乐陪玩": 0 },
        splitType: "tiered",
        tieredRatios: { "1档": 60, "2档": 40 },
      }),
      {},
      130,
    ),
    expected: { club: 18.2, workers: [70.2, 41.6] },
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
          tierRates: { "1档": 0, "2档": 15, "3档": 0, "娱乐陪玩": 0 },
        },
      ),
      {},
    ),
    expected: { club: 15, workers: [42.5, 42.5] },
  },
  {
    name: "by-tier equal: 两名打手的个人打赏分别入账",
    result: calculateSettlement(
      snapshot(100, 0, [worker("A", 50), worker("B", 50)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 40, "2档": 60, "3档": 0, "娱乐陪玩": 0 },
      }),
      { A: 5, B: 5 },
    ),
    expected: { club: 50, workers: [35, 25] },
  },
  {
    name: "验收样例: 168 元且只给 1档打手 10 元打赏",
    result: calculateSettlement(
      snapshot(168, 0, [worker("A", 50), worker("B", 50)], {
        commissionMode: "by_tier",
        tierRates: { "1档": 25, "2档": 20, "3档": 15, "娱乐陪玩": 0 },
      }),
      { A: 10, B: 0 },
    ),
    expected: { club: 37.8, workers: [73, 67.2] },
  },
  {
    name: "陪玩验收样例: 100 元/小时 × 2 小时 + 30 元特殊需求",
    result: calculateSettlement(
      {
        ...snapshot(200, 0, [worker("A", 50), worker("B", 50)], {
          commissionMode: "by_tier",
          tierRates: { "1档": 25, "2档": 20, "3档": 15, "娱乐陪玩": 0 },
        }),
        order_type: "companion",
        hourly_rate: 100,
      },
      {},
      230,
    ),
    expected: { club: 51.75, workers: [86.25, 92] },
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
        tierRates: { "1档": -1, "2档": 20, "3档": 0, "娱乐陪玩": 0 },
      }),
      {},
    ),
  /俱乐部抽成比例无效/,
  "by-tier: 负数抽成必须拒绝",
);
assert.throws(
  () =>
    calculateSettlement(
      snapshot(100, 10, [worker("A", 100)]),
      { A: -0.01 },
    ),
  /金额必须是非负数字/,
  "个人打赏不能为负数",
);
assert.throws(
  () =>
    calculateSettlement(
      snapshot(100, 10, [worker("A", 100)]),
      { B: 10 },
    ),
  /只能给本订单参与打手设置打赏/,
  "不能给订单外打手设置打赏",
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

const legacyOrder = {
  pricing_snapshot: snapshot(168, 0, [worker("A", 50), worker("B", 50)]),
  tip: 10,
  tips_by_worker: {},
} as Order;
assert.deepEqual(
  resolveOrderTipsByWorker(legacyOrder),
  { A: 5, B: 5 },
  "没有 tips_by_worker 的旧双人订单应按原规则回退平分总打赏",
);
assert.deepEqual(
  resolveOrderTipsByWorker({ ...legacyOrder, tips_by_worker: { A: 10, B: 0 } }),
  { A: 10, B: 0 },
  "新订单必须优先使用每名打手的独立打赏",
);
assert.equal(
  calculateOrderBasePrice(
    { order_type: "companion", base_price: 0, hourly_rate: 100 },
    1.5,
  ),
  150,
  "陪玩单基础价必须等于小时价乘时长",
);
assert.equal(
  calculateOrderBasePrice(
    { order_type: "escort", base_price: 200, hourly_rate: 0 },
    24,
  ),
  200,
  "护航单基础价不能受时长影响",
);
assert.throws(
  () => normalizeCompanionHours(0.5),
  /1 到 24 小时/,
  "陪玩时长不能小于 1 小时",
);
assert.throws(
  () => normalizeCompanionHours(1.25),
  /0.5 小时为步进/,
  "陪玩时长必须使用半小时步进",
);

console.log(
  `Settlement verification passed: ${cases.length} settlement scenarios + 13 validation assertions.`,
);
