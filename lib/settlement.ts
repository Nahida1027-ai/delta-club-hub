import type {
  CommissionMode,
  OrderPricingSnapshot,
  PayoutWeight,
  SettlementResult,
  SpecialRequirement,
  SplitType,
  TierCommissionRates,
  TieredRatios,
  Worker,
  WorkerTier,
} from "@/lib/club-types";

const MAX_MONEY_CENTS = 100_000_000_00;

export function defaultTierCommissionRates(): TierCommissionRates {
  return { "1档": 0, "2档": 0, "3档": 0 };
}

export function toCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("金额必须是非负数字");
  }
  const cents = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS) {
    throw new Error("金额超出安全范围");
  }
  return cents;
}

export function fromCents(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function splitLabel(splitType: SplitType): string {
  return {
    single: "单人全吃",
    equal: "两人平分",
    tiered: "按档位分",
  }[splitType];
}

export function validateMenuRule(input: {
  service_name: string;
  base_price: number;
  commission_mode?: CommissionMode;
  club_commission_rate: number;
  tier_commission_rates?: TierCommissionRates;
  split_type: SplitType;
  tiered_ratios: TieredRatios | null;
  eligible_tiers: WorkerTier[];
}) {
  if (!input.service_name.trim()) throw new Error("请填写服务名称");
  toCents(input.base_price);
  const commissionMode = input.commission_mode ?? "uniform";
  if (!(["uniform", "by_tier"] as CommissionMode[]).includes(commissionMode)) {
    throw new Error("请选择有效抽成模式");
  }
  if (commissionMode === "uniform") {
    if (
      !Number.isFinite(input.club_commission_rate) ||
      input.club_commission_rate < 0 ||
      input.club_commission_rate > 100
    ) {
      throw new Error("统一抽成必须在 0% 到 100% 之间");
    }
  } else {
    const rates = input.tier_commission_rates ?? defaultTierCommissionRates();
    (["1档", "2档", "3档"] as WorkerTier[]).forEach((tier) => {
      if (!Number.isFinite(rates[tier]) || rates[tier] < 0) {
        throw new Error(`${tier}抽成必须是非负数字`);
      }
    });
  }
  if (!input.eligible_tiers.length) throw new Error("至少选择一个可接档位");
  if (input.split_type === "tiered") {
    const first = input.tiered_ratios?.["1档"] ?? 0;
    const second = input.tiered_ratios?.["2档"] ?? 0;
    if (
      !Number.isFinite(first) ||
      !Number.isFinite(second) ||
      first <= 0 ||
      second <= 0 ||
      Math.abs(first + second - 100) > 0.0001
    ) {
      throw new Error("1档与2档占比必须都大于 0，且合计 100%");
    }
  }
}

export function getCommissionRate(
  input: {
    commission_mode?: CommissionMode;
    club_commission_rate: number;
    tier_commission_rates?: TierCommissionRates;
  },
  workerTier: WorkerTier,
) {
  if ((input.commission_mode ?? "uniform") === "by_tier") {
    return input.tier_commission_rates?.[workerTier] ?? 0;
  }
  return input.club_commission_rate;
}

export function normalizeSpecialRequirements(
  requirements: SpecialRequirement[],
): SpecialRequirement[] {
  if (!Array.isArray(requirements)) throw new Error("特殊需求格式无效");
  if (requirements.length > 20) throw new Error("一张订单最多添加 20 条特殊需求");

  return requirements.map((requirement, index) => {
    if (!requirement || typeof requirement !== "object") {
      throw new Error(`第 ${index + 1} 条特殊需求格式无效`);
    }
    const name = String(requirement.name ?? "").trim();
    if (!name) throw new Error(`请填写第 ${index + 1} 条特殊需求名称`);
    if (Array.from(name).length > 60) {
      throw new Error(`第 ${index + 1} 条特殊需求名称最多 60 个字符`);
    }
    return { name, price: fromCents(toCents(Number(requirement.price))) };
  });
}

export function specialRequirementsTotal(requirements: SpecialRequirement[]) {
  const totalCents = requirements.reduce(
    (sum, requirement) => sum + toCents(requirement.price),
    0,
  );
  if (!Number.isSafeInteger(totalCents) || totalCents > MAX_MONEY_CENTS) {
    throw new Error("特殊需求加价合计超出安全范围");
  }
  return fromCents(totalCents);
}

export function buildPayoutWeights(
  splitType: SplitType,
  selectedWorkers: Worker[],
  tieredRatios: TieredRatios | null,
): PayoutWeight[] {
  const uniqueIds = new Set(selectedWorkers.map((worker) => worker.id));
  if (uniqueIds.size !== selectedWorkers.length) throw new Error("不能重复选择同一名打手");

  if (splitType === "single") {
    if (selectedWorkers.length !== 1) throw new Error("单人模式必须分配 1 名打手");
    const worker = selectedWorkers[0];
    return [{ workerId: worker.id, workerName: worker.name, tier: worker.tier, weight: 100 }];
  }

  if (selectedWorkers.length !== 2) throw new Error("双人模式必须分配 2 名打手");
  if (splitType === "equal") {
    return selectedWorkers.map((worker) => ({
      workerId: worker.id,
      workerName: worker.name,
      tier: worker.tier,
      weight: 50,
    }));
  }

  const first = selectedWorkers.find((worker) => worker.tier === "1档");
  const second = selectedWorkers.find((worker) => worker.tier === "2档");
  if (!first || !second || selectedWorkers.some((worker) => worker.tier === "3档")) {
    throw new Error("按档位分必须各选择 1 名 1档与 1 名 2档打手");
  }
  const ratios = tieredRatios ?? { "1档": 60, "2档": 40 };
  return [first, second].map((worker) => ({
    workerId: worker.id,
    workerName: worker.name,
    tier: worker.tier,
    weight: ratios[worker.tier as "1档" | "2档"],
  }));
}

function allocateCentsByWeight(totalCents: number, weights: PayoutWeight[]) {
  const weighted = weights.map((entry, index) => {
    if (!Number.isFinite(entry.weight) || entry.weight < 0) {
      throw new Error("打手分配权重无效");
    }
    const weightBps = Math.round(entry.weight * 100);
    if (!Number.isSafeInteger(weightBps)) {
      throw new Error("打手分配权重超出安全范围");
    }
    const numerator = totalCents * weightBps;
    if (!Number.isSafeInteger(numerator)) {
      throw new Error("订单分配金额超出安全范围");
    }
    return {
      ...entry,
      index,
      weightBps,
      cents: Math.floor(numerator / 10_000),
      remainder: numerator % 10_000,
    };
  });

  if (weighted.reduce((sum, entry) => sum + entry.weightBps, 0) !== 10_000) {
    throw new Error("打手分配权重合计必须为 100%");
  }

  const allocated = weighted.reduce((sum, entry) => sum + entry.cents, 0);
  let remaining = totalCents - allocated;
  const remainderOrder = [...weighted].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    remainderOrder[index % remainderOrder.length].cents += 1;
  }

  return weighted.map((entry) => entry.cents);
}

export function calculateSettlement(
  snapshot: OrderPricingSnapshot,
  tip: number,
  orderOriginalTotal = snapshot.base_price,
): SettlementResult {
  const originalTotalCents = toCents(orderOriginalTotal);
  const tipCents = toCents(tip);
  if (!snapshot.payout_weights.length) throw new Error("订单没有可结算的打手");

  const totalPoolCents = originalTotalCents + tipCents;
  if (!Number.isSafeInteger(totalPoolCents) || totalPoolCents > MAX_MONEY_CENTS) {
    throw new Error("订单总金额超出安全范围");
  }

  const commissionMode = snapshot.commission_mode ?? "uniform";
  if (commissionMode !== "uniform" && commissionMode !== "by_tier") {
    throw new Error("订单抽成模式无效");
  }
  /*
   * 财务核心（全部按整数分计算）：
   * 1. 先按 split 权重拆分订单原始总价；single 为 100%，equal 为 50% / 50%。
   * 2. 每名打手实得基础收入 = 自己的订单份额 × (1 - 自己档位的抽成率)。
   * 3. 俱乐部抽成 = 每名打手订单份额对应的抽成之和。
   * 4. 打赏另行按同一权重分配，不参与任何抽成。
   *
   * 168 元 equal 示例：1档 25%、2档 20%。两人的订单份额均为 84 元，
   * 1档实得 84 × 75% = 63 元，2档实得 84 × 80% = 67.2 元，
   * 俱乐部实得 168 - 63 - 67.2 = 37.8 元。
   */
  const originalShares = allocateCentsByWeight(
    originalTotalCents,
    snapshot.payout_weights,
  );
  const tipShares = allocateCentsByWeight(tipCents, snapshot.payout_weights);

  let clubIncomeCents = 0;
  const workerIncomes = snapshot.payout_weights.map((entry, index) => {
    const rate = getCommissionRate(snapshot, entry.tier);
    if (!Number.isFinite(rate) || rate < 0) {
      throw new Error("俱乐部抽成比例无效");
    }
    const rateBps = Math.round(rate * 100);
    const commissionNumerator = originalShares[index] * rateBps;
    if (!Number.isSafeInteger(rateBps) || !Number.isSafeInteger(commissionNumerator)) {
      throw new Error("俱乐部抽成比例超出安全范围");
    }
    const commissionCents = Math.round(commissionNumerator / 10_000);
    clubIncomeCents += commissionCents;
    return {
      workerId: entry.workerId,
      cents: originalShares[index] - commissionCents + tipShares[index],
    };
  });
  if (!Number.isSafeInteger(clubIncomeCents)) {
    throw new Error("俱乐部抽成金额超出安全范围");
  }

  const workerPoolCents = workerIncomes.reduce(
    (sum, entry) => sum + entry.cents,
    0,
  );

  return {
    total_pool: fromCents(totalPoolCents),
    club_income: fromCents(clubIncomeCents),
    worker_pool: fromCents(workerPoolCents),
    worker_incomes: workerIncomes.map((entry) => ({
      workerId: entry.workerId,
      amount: fromCents(entry.cents),
    })),
  };
}
