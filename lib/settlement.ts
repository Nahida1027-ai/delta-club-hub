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
  const commissionRates = commissionMode === "by_tier"
    ? snapshot.payout_weights.map((entry) => getCommissionRate(snapshot, entry.tier))
    : [getCommissionRate(snapshot, snapshot.payout_weights[0].tier)];
  const clubIncomeCents = commissionRates.reduce((sum, rate) => {
    if (!Number.isFinite(rate) || rate < 0) throw new Error("俱乐部抽成比例无效");
    const rateBps = Math.round(rate * 100);
    const numerator = originalTotalCents * rateBps;
    if (!Number.isSafeInteger(rateBps) || !Number.isSafeInteger(numerator)) {
      throw new Error("俱乐部抽成比例超出安全范围");
    }
    return sum + Math.round(numerator / 10_000);
  }, 0);
  if (clubIncomeCents > originalTotalCents) {
    throw new Error("本单所选打手的档位抽成合计不能超过 100%");
  }

  // 特殊需求与基础价一起参与抽成；打赏在扣完抽成后才加入，因此始终 100% 归打手池。
  const workerPoolCents = originalTotalCents - clubIncomeCents + tipCents;
  const weightBpsTotal = snapshot.payout_weights.reduce(
    (sum, entry) => sum + Math.round(entry.weight * 100),
    0,
  );
  if (weightBpsTotal !== 10_000) throw new Error("打手分配权重合计必须为 100%");

  const weights = snapshot.payout_weights.map((entry, index) => {
    const weightBps = Math.round(entry.weight * 100);
    if (!Number.isFinite(entry.weight) || weightBps < 0) {
      throw new Error("打手分配权重无效");
    }
    const numerator = workerPoolCents * weightBps;
    return {
      ...entry,
      index,
      cents: Math.floor(numerator / 10_000),
      remainder: numerator % 10_000,
    };
  });

  const allocated = weights.reduce((sum, entry) => sum + entry.cents, 0);
  let remaining = workerPoolCents - allocated;
  const remainderOrder = [...weights].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    remainderOrder[index % remainderOrder.length].cents += 1;
  }

  return {
    total_pool: fromCents(totalPoolCents),
    club_income: fromCents(clubIncomeCents),
    worker_pool: fromCents(workerPoolCents),
    worker_incomes: weights.map((entry) => ({
      workerId: entry.workerId,
      amount: fromCents(entry.cents),
    })),
  };
}
