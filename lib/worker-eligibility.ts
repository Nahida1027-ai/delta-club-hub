import type {
  CommissionMode,
  PriceMenuItem,
  SplitType,
  Worker,
  WorkerTier,
} from "@/lib/club-types";

type AssignmentRule = Pick<PriceMenuItem, "commission_mode" | "split_type" | "eligible_tiers">;

/**
 * 娱乐陪玩没有档位，但按档位抽成时使用“娱乐陪玩”专属比例。
 * 旧的 tiered 分配仍要求 1档 + 2档，因此娱乐陪玩不参与该分配模式。
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
    return rule.split_type !== "tiered";
  }
  return worker.tier !== null && rule.eligible_tiers.includes(worker.tier);
}

export function isWorkerEligibleForMenuItem(
  item: AssignmentRule,
  worker: Pick<Worker, "workerType" | "tier">,
) {
  return isWorkerEligibleForRule(item, worker);
}
