import type {
  CommissionMode,
  PriceMenuItem,
  SplitType,
  Worker,
  WorkerTier,
} from "@/lib/club-types";

type AssignmentRule = Pick<PriceMenuItem, "commission_mode" | "split_type" | "eligible_tiers">;

/**
 * 娱乐陪玩没有档位，因此只能参加统一抽成且不依赖档位权重的订单。
 * 普通打手继续严格匹配服务配置的 eligible_tiers。
 */
export function isWorkerEligibleForRule(
  rule: {
    commission_mode: CommissionMode;
    split_type: SplitType;
    eligible_tiers: WorkerTier[];
  },
  worker: Pick<Worker, "workerType" | "tier">,
) {
  if (worker.workerType === "entertainment") {
    return rule.commission_mode === "uniform" && rule.split_type !== "tiered";
  }
  return worker.tier !== null && rule.eligible_tiers.includes(worker.tier);
}

export function isWorkerEligibleForMenuItem(
  item: AssignmentRule,
  worker: Pick<Worker, "workerType" | "tier">,
) {
  return isWorkerEligibleForRule(item, worker);
}
