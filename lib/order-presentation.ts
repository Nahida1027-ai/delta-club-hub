import { fromCents, toCents } from "@/lib/settlement";

export const ORDER_NO_PATTERN = /^[A-Za-z0-9_-]{3,30}$/;

function chinaDateParts(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/**
 * 给新订单生成可读编号。重复编号允许由业务方确认后继续，因此随机尾号只用于降低碰撞概率。
 */
export function createDefaultOrderNo(
  value: string | number | Date = new Date(),
  random = Math.random,
) {
  const parts = chinaDateParts(value);
  const day = parts ? `${parts.year}${parts.month}${parts.day}` : "00000000";
  const suffix = Math.max(0, Math.min(9999, Math.floor(random() * 10_000)))
    .toString()
    .padStart(4, "0");
  return `DF-${day}-${suffix}`;
}

/** 旧订单没有存储自定义编号时使用稳定的展示回退值，不写回原始账务。 */
export function fallbackOrderNo(order: Pick<{
  id: string;
  created_at: string;
  custom_order_no?: string;
}, "id" | "created_at" | "custom_order_no">) {
  const stored = order.custom_order_no?.trim();
  if (stored) return stored;
  const parts = chinaDateParts(order.created_at);
  const day = parts ? `${parts.year}${parts.month}${parts.day}` : "00000000";
  const suffix = order.id.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase().padStart(4, "0");
  return `DF-${day}-${suffix}`;
}

export function normalizeCustomOrderNo(value: unknown) {
  const orderNo = String(value ?? "").trim();
  if (!ORDER_NO_PATTERN.test(orderNo)) {
    throw new Error("订单编号需为 3–30 位字母、数字、短横线或下划线");
  }
  return orderNo;
}

/** 允许空值；有值时限制为百分比且保留两位小数。 */
export function normalizeOptionalPercentage(value: unknown, label: string): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const percentage = Number(value);
  const basisPoints = Math.round(percentage * 100);
  if (
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100 ||
    !Number.isSafeInteger(basisPoints)
  ) {
    throw new Error(`${label}必须是 0–100 之间的数字`);
  }
  return basisPoints / 100;
}

/**
 * 折扣的唯一金额口径：先以整数分计算折扣，再由折后总价参与抽成和工资结算。
 */
export function calculateDiscountedOrderTotals(
  basePrice: number,
  specialTotal: number,
  overrideDiscount: number | null | undefined,
) {
  const baseCents = toCents(basePrice);
  const specialCents = toCents(specialTotal);
  const originalTotalCents = baseCents + specialCents;
  if (!Number.isSafeInteger(originalTotalCents)) throw new Error("订单总金额超出安全范围");
  const discount = normalizeOptionalPercentage(overrideDiscount, "临时折扣");
  const discountBasisPoints = Math.round((discount ?? 0) * 100);
  const discountCents = Math.round((originalTotalCents * discountBasisPoints) / 10_000);
  const totalCents = originalTotalCents - discountCents;
  return {
    overrideDiscount: discount,
    originalTotalBeforeDiscount: fromCents(originalTotalCents),
    discountAmount: fromCents(discountCents),
    totalPrice: fromCents(totalCents),
  };
}

export function displayCreatedAt(order: Pick<{
  created_at: string;
  display_created_at?: string;
}, "created_at" | "display_created_at">) {
  return order.display_created_at || order.created_at;
}

export function displayCompletedAt(order: Pick<{
  completed_at: string | null;
  display_completed_at?: string | null;
}, "completed_at" | "display_completed_at">) {
  return order.display_completed_at ?? order.completed_at;
}
