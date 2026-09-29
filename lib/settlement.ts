import type {
  CommissionMode,
  Order,
  OrderPricingSnapshot,
  OrderType,
  PayoutWeight,
  PriceMenuItem,
  SettlementResult,
  SpecialRequirement,
  SplitType,
  TierCommissionRates,
  TieredRatios,
  TipsByWorker,
  Worker,
  WorkerEarningsByWorker,
  WorkerTier,
} from "@/lib/club-types";

const MAX_MONEY_CENTS = 100_000_000_00;

export function defaultTierCommissionRates(): TierCommissionRates {
  return { "1档": 0, "2档": 0, "3档": 0, "娱乐陪玩": 0 };
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

export function normalizeOrderType(value: unknown): OrderType {
  return value === "companion" ? "companion" : "escort";
}

export function orderTypeLabel(orderType: OrderType): string {
  return orderType === "companion" ? "陪玩单" : "护航单";
}

/** 陪玩时长统一限制为 1–24 小时，并严格使用 0.5 小时步进。 */
export function normalizeCompanionHours(value: unknown): number {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
    throw new Error("陪玩时长必须在 1 到 24 小时之间");
  }
  const halfHourUnits = Math.round(hours * 2);
  if (Math.abs(hours * 2 - halfHourUnits) > 0.000001) {
    throw new Error("陪玩时长必须以 0.5 小时为步进");
  }
  return halfHourUnits / 2;
}

/**
 * 把服务计价统一转换为本单基础价格。陪玩单先按小时计算并四舍五入到分，
 * 此后特殊需求、抽成、独立打赏和汇总均继续使用既有金额模型。
 */
export function calculateOrderBasePrice(
  input: Pick<PriceMenuItem, "order_type" | "base_price" | "hourly_rate">,
  hours = 1,
): number {
  if (normalizeOrderType(input.order_type) === "escort") {
    const basePriceCents = toCents(Number(input.base_price));
    if (basePriceCents <= 0) throw new Error("基础价格必须大于 0");
    return fromCents(basePriceCents);
  }

  const hourlyRateCents = toCents(Number(input.hourly_rate));
  if (hourlyRateCents <= 0) throw new Error("每小时价格必须大于 0");
  const halfHourUnits = normalizeCompanionHours(hours) * 2;
  const basePriceCents = Math.round((hourlyRateCents * halfHourUnits) / 2);
  if (!Number.isSafeInteger(basePriceCents) || basePriceCents > MAX_MONEY_CENTS) {
    throw new Error("陪玩单基础价格超出安全范围");
  }
  return fromCents(basePriceCents);
}

export function validateMenuRule(input: {
  service_name: string;
  order_type?: OrderType;
  base_price: number;
  hourly_rate?: number;
  commission_mode?: CommissionMode;
  club_commission_rate: number;
  tier_commission_rates?: TierCommissionRates;
  split_type: SplitType;
  tiered_ratios: TieredRatios | null;
  eligible_tiers: WorkerTier[];
}) {
  if (!input.service_name.trim()) throw new Error("请填写服务名称");
  calculateOrderBasePrice(
    {
      order_type: normalizeOrderType(input.order_type),
      base_price: Number(input.base_price),
      hourly_rate: Number(input.hourly_rate ?? 0),
    },
    1,
  );
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
    (["1档", "2档", "3档", "娱乐陪玩"] as const).forEach((key) => {
      if (!Number.isFinite(rates[key]) || rates[key] < 0) {
        throw new Error(`${key}抽成必须是非负数字`);
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
  worker: Pick<Worker, "workerType" | "tier">,
) {
  if ((input.commission_mode ?? "uniform") === "by_tier") {
    if (worker.workerType === "entertainment") {
      return input.tier_commission_rates?.["娱乐陪玩"] ?? 0;
    }
    if (worker.tier === null) throw new Error("普通打手缺少档位，无法计算抽成");
    return input.tier_commission_rates?.[worker.tier] ?? 0;
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
    return [{ workerId: worker.id, workerName: worker.name, workerType: worker.workerType, tier: worker.tier, weight: 100 }];
  }

  if (selectedWorkers.length !== 2) throw new Error("双人模式必须分配 2 名打手");
  if (splitType === "equal") {
    return selectedWorkers.map((worker) => ({
      workerId: worker.id,
      workerName: worker.name,
      workerType: worker.workerType,
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
    workerType: worker.workerType,
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

function sumTipCents(tipsByWorker: TipsByWorker) {
  const totalCents = Object.values(tipsByWorker).reduce(
    (sum, amount) => sum + toCents(amount),
    0,
  );
  if (!Number.isSafeInteger(totalCents) || totalCents > MAX_MONEY_CENTS) {
    throw new Error("打赏合计超出安全范围");
  }
  return totalCents;
}

/**
 * 只接受当前订单参与打手的打赏，并将遗漏的打手补为 0。
 * 所有金额都先转为整数分再返回，避免浮点金额进入结算。
 */
export function normalizeTipsByWorker(
  snapshot: OrderPricingSnapshot,
  value: unknown,
): TipsByWorker {
  const input = value ?? {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("按打手打赏格式无效");
  }

  const workerIds = snapshot.payout_weights.map((entry) => entry.workerId);
  const allowedWorkerIds = new Set(workerIds);
  if (allowedWorkerIds.size !== workerIds.length) {
    throw new Error("订单包含重复打手，无法结算");
  }

  const rawTips = input as Record<string, unknown>;
  for (const workerId of Object.keys(rawTips)) {
    if (!allowedWorkerIds.has(workerId)) {
      throw new Error("只能给本订单参与打手设置打赏");
    }
  }

  const normalized = Object.fromEntries(
    workerIds.map((workerId) => [
      workerId,
      fromCents(toCents(Number(rawTips[workerId] ?? 0))),
    ]),
  ) as TipsByWorker;
  sumTipCents(normalized);
  return normalized;
}

export function tipsByWorkerTotal(tipsByWorker: TipsByWorker) {
  return fromCents(sumTipCents(tipsByWorker));
}

/** 仅用于没有 tips_by_worker 的历史订单，复现旧版按冻结权重拆分总打赏的展示。 */
export function legacyTipsByWorker(
  snapshot: OrderPricingSnapshot,
  tip: number,
): TipsByWorker {
  const shares = allocateCentsByWeight(toCents(tip), snapshot.payout_weights);
  return Object.fromEntries(
    snapshot.payout_weights.map((entry, index) => [
      entry.workerId,
      fromCents(shares[index]),
    ]),
  ) as TipsByWorker;
}

export function resolveOrderTipsByWorker(
  order: Pick<Order, "pricing_snapshot" | "tip" | "tips_by_worker">,
): TipsByWorker {
  const explicitTips = order.tips_by_worker ?? {};
  return Object.keys(explicitTips).length
    ? normalizeTipsByWorker(order.pricing_snapshot, explicitTips)
    : legacyTipsByWorker(order.pricing_snapshot, order.tip);
}

export function orderTipTotal(
  order: Pick<Order, "pricing_snapshot" | "tip" | "tips_by_worker">,
) {
  return tipsByWorkerTotal(resolveOrderTipsByWorker(order));
}

export function calculateSettlement(
  snapshot: OrderPricingSnapshot,
  tipsByWorker: TipsByWorker,
  orderOriginalTotal = snapshot.base_price,
): SettlementResult {
  const originalTotalCents = toCents(orderOriginalTotal);
  if (!snapshot.payout_weights.length) throw new Error("订单没有可结算的打手");
  const normalizedTips = normalizeTipsByWorker(snapshot, tipsByWorker);
  const tipCents = sumTipCents(normalizedTips);

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
   * 4. 每名打手最终收入 = 基础收入 + tips_by_worker[workerId]；个人打赏不参与抽成。
   *
   * 168 元 equal 示例：1档 25%、2档 20%。两人的订单份额均为 84 元，
   * 1档实得 84 × 75% = 63 元，2档实得 84 × 80% = 67.2 元，
   * 俱乐部实得 168 - 63 - 67.2 = 37.8 元。若只给 1档打手打赏 10 元，
   * 两人最终收入分别为 73 元、67.2 元，俱乐部仍实得 37.8 元。
   */
  const originalShares = allocateCentsByWeight(
    originalTotalCents,
    snapshot.payout_weights,
  );
  let clubIncomeCents = 0;
  const workerIncomes = snapshot.payout_weights.map((entry, index) => {
    const rate = getCommissionRate(snapshot, {
      workerType: entry.workerType ?? (entry.tier === null ? "entertainment" : "standard"),
      tier: entry.tier,
    });
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
      cents:
        originalShares[index] -
        commissionCents +
        toCents(normalizedTips[entry.workerId] ?? 0),
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

/**
 * 转单费属于新打手工资，但独立于订单价款与俱乐部抽成：
 * - 新打手工资 = 原订单份额 + 转单费；
 * - 俱乐部实得始终沿用原订单抽成，不扣减转单费；
 * - 被换下打手的既有账面收入不做任何扣减。
 * 转单费不属于打赏，也不会写入 worker_tip_earnings。
 */
export function calculateSettlementWithTransferFees(
  snapshot: OrderPricingSnapshot,
  tipsByWorker: TipsByWorker,
  orderOriginalTotal: number,
  transferFeesByWorker: WorkerEarningsByWorker = {},
): SettlementResult {
  const base = calculateSettlement(snapshot, tipsByWorker, orderOriginalTotal);
  const workerIds = snapshot.payout_weights.map((entry) => entry.workerId);
  const allowedWorkerIds = new Set(workerIds);
  for (const workerId of Object.keys(transferFeesByWorker ?? {})) {
    if (!allowedWorkerIds.has(workerId)) {
      throw new Error("转单费只能归属于当前订单参与打手");
    }
  }

  const normalizedFees = Object.fromEntries(
    workerIds.map((workerId) => [
      workerId,
      fromCents(toCents(Number(transferFeesByWorker?.[workerId] ?? 0))),
    ]),
  ) as WorkerEarningsByWorker;
  const transferFeeCents = Object.values(normalizedFees).reduce(
    (sum, amount) => sum + toCents(amount),
    0,
  );
  if (!Number.isSafeInteger(transferFeeCents) || transferFeeCents > MAX_MONEY_CENTS) {
    throw new Error("转单费合计超出安全范围");
  }
  const workerPoolCents = toCents(base.worker_pool) + transferFeeCents;
  if (
    !Number.isSafeInteger(workerPoolCents) ||
    workerPoolCents > MAX_MONEY_CENTS
  ) {
    throw new Error("转单后的结算金额超出安全范围");
  }

  return {
    ...base,
    // 转单费是独立工资补偿，不改变订单本身计算出的俱乐部抽成。
    club_income: base.club_income,
    worker_pool: fromCents(workerPoolCents),
    worker_incomes: base.worker_incomes.map((income) => ({
      ...income,
      amount: fromCents(
        toCents(income.amount) + toCents(normalizedFees[income.workerId] ?? 0),
      ),
    })),
  };
}
