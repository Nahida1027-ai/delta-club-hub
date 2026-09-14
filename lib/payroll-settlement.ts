import type {
  Order,
  SettlementRecord,
  Worker,
  WorkerSettlementConfig,
} from "@/lib/club-types";

export const DEFAULT_SETTLEMENT_INTERVAL_DAYS = 3;
export const DEFAULT_SETTLEMENT_TIME = "20:00";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeSettlementIntervalDays(value: unknown): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("结算间隔必须是 1 到 3650 之间的整数天");
  }
  return days;
}

export function normalizeSettlementTime(value: unknown): string {
  const time = String(value ?? "");
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error("结算时间必须使用 HH:mm 格式");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error("请输入有效的结算时间");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function defaultSettlementConfig(): WorkerSettlementConfig {
  return {
    interval_days: DEFAULT_SETTLEMENT_INTERVAL_DAYS,
    settlement_time: DEFAULT_SETTLEMENT_TIME,
    last_settled_at: null,
    next_settlement_at: null,
  };
}

/**
 * 按 Asia/Shanghai 日历天计算，不使用浏览器或边缘运行时的本地时区。
 * 例如起点为 1 日 10:00、间隔 3 天、结算时间 20:00，结果恒为 4 日 20:00。
 */
export function calculateNextSettlementTime(
  worker: Pick<Worker, "joined_at" | "settlement_config">,
  now = Date.now(),
): number {
  const intervalDays = normalizeSettlementIntervalDays(
    worker.settlement_config?.interval_days ?? DEFAULT_SETTLEMENT_INTERVAL_DAYS,
  );
  const settlementTime = normalizeSettlementTime(
    worker.settlement_config?.settlement_time ?? DEFAULT_SETTLEMENT_TIME,
  );
  const startPoint =
    worker.settlement_config?.last_settled_at ?? worker.joined_at ?? now;
  const [hours, minutes] = settlementTime.split(":").map(Number);

  // 先把时间轴平移到上海时区，再用 UTC API 操作日历，避免服务器 UTC 与浏览器时区不同。
  const shanghaiDate = new Date(startPoint + SHANGHAI_OFFSET_MS);
  shanghaiDate.setUTCDate(shanghaiDate.getUTCDate() + intervalDays);
  shanghaiDate.setUTCHours(hours, minutes, 0, 0);
  return shanghaiDate.getTime() - SHANGHAI_OFFSET_MS;
}

export function calculateWorkerEarningForOrder(
  order: Pick<Order, "final_worker_incomes">,
  workerId: string,
): number {
  return order.final_worker_incomes.find((income) => income.workerId === workerId)?.amount ?? 0;
}

export function getOrdersInPeriod(
  orders: Order[],
  workerId: string,
  periodStart: number,
  periodEnd: number,
): Order[] {
  return orders.filter((order) => {
    if (order.status !== "completed" || !order.completed_at) return false;
    if (order.settlement_ids_by_worker?.[workerId]) return false;
    const completedAt = Date.parse(order.completed_at);
    return (
      Number.isFinite(completedAt) &&
      completedAt >= periodStart &&
      completedAt <= periodEnd &&
      order.final_worker_incomes.some((income) => income.workerId === workerId)
    );
  });
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

/** 供测试与日期筛选使用；上海时区没有夏令时，一天可稳定平移。 */
export const PAYROLL_DAY_MS = DAY_MS;
