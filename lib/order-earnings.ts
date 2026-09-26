import type {
  Order,
  TipsByWorker,
  WorkerEarningsByWorker,
  WorkerIncome,
} from "@/lib/club-types";
import {
  fromCents,
  normalizeTipsByWorker,
  resolveOrderTipsByWorker,
  toCents,
} from "@/lib/settlement";

function hasStoredAmounts(value: WorkerEarningsByWorker | null | undefined) {
  return Boolean(value && Object.keys(value).length);
}

function normalizeStoredAmounts(
  workerIds: string[],
  value: WorkerEarningsByWorker,
): WorkerEarningsByWorker {
  return Object.fromEntries(
    workerIds.map((workerId) => [
      workerId,
      fromCents(Math.max(0, toCents(Number(value[workerId] ?? 0)))),
    ]),
  );
}

/**
 * 新订单优先读取即时打赏快照；旧订单则由 tips_by_worker / 旧 tip 字段回退。
 */
export function resolveWorkerTipEarnings(
  order: Pick<
    Order,
    "pricing_snapshot" | "tip" | "tips_by_worker" | "worker_tip_earnings"
  >,
): WorkerEarningsByWorker {
  if (hasStoredAmounts(order.worker_tip_earnings)) {
    return normalizeTipsByWorker(
      order.pricing_snapshot,
      order.worker_tip_earnings,
    );
  }
  return resolveOrderTipsByWorker(order);
}

/**
 * 历史订单兼容：旧 final_worker_incomes 包含打赏，因此以最终收入减去个人打赏，
 * 得到只进入工资周期的订单工资。新订单直接读取 worker_order_earnings 快照。
 */
export function resolveWorkerOrderEarnings(
  order: Pick<
    Order,
    | "pricing_snapshot"
    | "tip"
    | "tips_by_worker"
    | "worker_tip_earnings"
    | "worker_order_earnings"
    | "final_worker_incomes"
  >,
): WorkerEarningsByWorker {
  if (hasStoredAmounts(order.worker_order_earnings)) {
    return normalizeStoredAmounts(
      order.pricing_snapshot.payout_weights.map((entry) => entry.workerId),
      order.worker_order_earnings,
    );
  }

  const tips = resolveWorkerTipEarnings(order);
  return Object.fromEntries(
    order.final_worker_incomes.map((income) => [
      income.workerId,
      fromCents(
        Math.max(
          0,
          toCents(income.amount) - toCents(tips[income.workerId] ?? 0),
        ),
      ),
    ]),
  );
}

export function deriveWorkerOrderEarnings(
  finalWorkerIncomes: WorkerIncome[],
  tipsByWorker: TipsByWorker,
): WorkerEarningsByWorker {
  return Object.fromEntries(
    finalWorkerIncomes.map((income) => [
      income.workerId,
      fromCents(
        Math.max(
          0,
          toCents(income.amount) - toCents(tipsByWorker[income.workerId] ?? 0),
        ),
      ),
    ]),
  );
}

export function workerOrderEarningForOrder(
  order: Parameters<typeof resolveWorkerOrderEarnings>[0],
  workerId: string,
) {
  return resolveWorkerOrderEarnings(order)[workerId] ?? 0;
}

export function workerTipEarningForOrder(
  order: Parameters<typeof resolveWorkerTipEarnings>[0],
  workerId: string,
) {
  return resolveWorkerTipEarnings(order)[workerId] ?? 0;
}

export function totalEarningsMap(value: WorkerEarningsByWorker) {
  return fromCents(
    Object.values(value).reduce((sum, amount) => sum + toCents(amount), 0),
  );
}
