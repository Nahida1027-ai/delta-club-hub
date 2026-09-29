import type {
  Order,
  SettlementPeriod,
  SettlementRecord,
  WorkerSettlementConfig,
} from "@/lib/club-types";
import { workerOrderEarningForOrder } from "@/lib/order-earnings";

export const DEFAULT_SETTLEMENT_INTERVAL_DAYS = 3;
export const DEFAULT_SETTLEMENT_REMINDER_HOURS = 72;
export const PAYROLL_HOUR_MS = 60 * 60 * 1000;
export const PAYROLL_DAY_MS = 24 * PAYROLL_HOUR_MS;

export function normalizeSettlementIntervalDays(value: unknown): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("结算间隔必须是 1 到 3650 之间的整数天");
  }
  return days;
}

export function normalizeSettlementReminderHours(value: unknown): number {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 87_600) {
    throw new Error("待发放提醒必须是 1 到 87600 之间的整数小时");
  }
  return hours;
}

export function defaultSettlementConfig(): WorkerSettlementConfig {
  return {
    interval_days: DEFAULT_SETTLEMENT_INTERVAL_DAYS,
    reminder_hours: DEFAULT_SETTLEMENT_REMINDER_HOURS,
  };
}

export function calculateWorkerEarningForOrder(
  order: Pick<
    Order,
    | "pricing_snapshot"
    | "tip"
    | "tips_by_worker"
    | "worker_tip_earnings"
    | "worker_order_earnings"
    | "final_worker_incomes"
  >,
  workerId: string,
): number {
  return workerOrderEarningForOrder(order, workerId);
}

/**
 * 只收集明确归属于该打手当前周期、且在管理员指定结束时间内完成的订单。
 * 双人订单通过 settlement_period_ids_by_worker 分别关联两名打手的周期。
 * 周期被删除后遗留的未结订单会在下一次接单创建新周期时重新挂入；此时订单
 * 可能早于新周期展示起点，因此以显式周期关联为准，不再重复限制完成时间下界。
 */
export function getOrdersForSettlementPeriod(
  orders: Order[],
  workerId: string,
  period: Pick<SettlementPeriod, "id" | "started_at">,
  endedAt: number,
): Order[] {
  return orders.filter((order) => {
    if (order.status !== "completed" || !order.completed_at) return false;
    if (order.settlement_ids_by_worker?.[workerId]) return false;
    if (order.settlement_period_ids_by_worker?.[workerId] !== period.id) return false;
    const completedAt = Date.parse(order.completed_at);
    return (
      Number.isFinite(completedAt) &&
      completedAt <= endedAt &&
      order.final_worker_incomes.some((income) => income.workerId === workerId)
    );
  });
}

export function getSettlementOverdueHours(
  record: Pick<SettlementRecord, "status" | "created_at">,
  now = Date.now(),
): number {
  if (record.status !== "pending") return 0;
  return Math.max(0, Math.floor((now - record.created_at) / PAYROLL_HOUR_MS));
}

export function isSettlementOverdue(
  record: Pick<SettlementRecord, "status" | "created_at">,
  reminderHours = DEFAULT_SETTLEMENT_REMINDER_HOURS,
  now = Date.now(),
): boolean {
  return (
    record.status === "pending" &&
    now - record.created_at >= normalizeSettlementReminderHours(reminderHours) * PAYROLL_HOUR_MS
  );
}

export function formatSettlementDuration(startedAt: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - startedAt);
  const days = Math.floor(elapsed / PAYROLL_DAY_MS);
  const hours = Math.floor((elapsed % PAYROLL_DAY_MS) / PAYROLL_HOUR_MS);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  return `${hours} 小时`;
}

export function formatSettlementDateTime(timestamp: number | null): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function isSettlementRecordPaid(
  record: Pick<SettlementRecord, "status">,
): boolean {
  return record.status === "paid";
}
