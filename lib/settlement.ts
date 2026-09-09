import type {
  OrderPricingSnapshot,
  PayoutWeight,
  SettlementResult,
  SplitType,
  TieredRatios,
  Worker,
  WorkerTier,
} from "@/lib/club-types";

const MAX_MONEY_CENTS = 100_000_000_00;

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
  club_commission_rate: number;
  split_type: SplitType;
  tiered_ratios: TieredRatios | null;
  eligible_tiers: WorkerTier[];
}) {
  if (!input.service_name.trim()) throw new Error("请填写服务名称");
  toCents(input.base_price);
  if (
    !Number.isFinite(input.club_commission_rate) ||
    input.club_commission_rate < 0 ||
    input.club_commission_rate > 100
  ) {
    throw new Error("俱乐部抽成必须在 0% 到 100% 之间");
  }
  if (!input.eligible_tiers.length) throw new Error("至少选择一个可接档位");
  if (input.split_type === "tiered") {
    const first = input.tiered_ratios?.["1档"] ?? 0;
    const second = input.tiered_ratios?.["2档"] ?? 0;
    if (first <= 0 || second <= 0 || Math.abs(first + second - 100) > 0.0001) {
      throw new Error("1档与2档占比必须都大于 0，且合计 100%");
    }
  }
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

/**
 * 用整数分 + 最大余数法结算，确保俱乐部收入 + 打手收入始终等于基础价 + 打赏。
 * 打赏只进入打手池，不参与俱乐部抽成。
 */
export function calculateSettlement(
  snapshot: OrderPricingSnapshot,
  tip: number,
): SettlementResult {
  const baseCents = toCents(snapshot.base_price);
  const tipCents = toCents(tip);
  const commissionBps = Math.round(snapshot.club_commission_rate * 100);

  const totalPoolCents = baseCents + tipCents;
  const clubIncomeCents = Math.round((baseCents * commissionBps) / 10_000);
  const workerPoolCents = totalPoolCents - clubIncomeCents;

  const weights = snapshot.payout_weights.map((entry, index) => {
    const weightBps = Math.round(entry.weight * 100);
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

