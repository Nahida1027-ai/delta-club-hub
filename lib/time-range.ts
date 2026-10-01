export type TimeRangePreset = "all" | "today" | "week" | "month" | "custom";

export interface TimeRangeFilter {
  preset: TimeRangePreset;
  from: string;
  to: string;
}

export const ALL_TIME_RANGE: TimeRangeFilter = {
  preset: "all",
  from: "",
  to: "",
};

function shanghaiParts(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function shanghaiDayStart(value: string | number | Date) {
  const parts = shanghaiParts(value);
  if (!parts) return Number.NaN;
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`);
}

function customStart(value: string) {
  return value ? Date.parse(`${value}T00:00:00+08:00`) : Number.NEGATIVE_INFINITY;
}

function customEnd(value: string) {
  return value ? Date.parse(`${value}T23:59:59.999+08:00`) : Number.POSITIVE_INFINITY;
}

/** 所有财务统计传入原始 created_at；订单列表传入 display_created_at。 */
export function matchesTimeRange(
  value: string | number | null | undefined,
  filter: TimeRangeFilter,
  now = Date.now(),
) {
  if (filter.preset === "all") return true;
  if (value === null || value === undefined || value === "") return false;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  if (filter.preset === "custom") {
    return timestamp >= customStart(filter.from) && timestamp <= customEnd(filter.to);
  }

  const currentDayStart = shanghaiDayStart(now);
  if (!Number.isFinite(currentDayStart)) return false;
  if (filter.preset === "today") {
    return timestamp >= currentDayStart && timestamp < currentDayStart + 24 * 60 * 60 * 1000;
  }
  if (filter.preset === "week") {
    const weekday = shanghaiParts(now)?.weekday ?? "周一";
    const weekdayOffsets: Record<string, number> = {
      "周一": 0,
      "周二": 1,
      "周三": 2,
      "周四": 3,
      "周五": 4,
      "周六": 5,
      "周日": 6,
      "星期一": 0,
      "星期二": 1,
      "星期三": 2,
      "星期四": 3,
      "星期五": 4,
      "星期六": 5,
      "星期日": 6,
    };
    const weekdayOffset = weekdayOffsets[weekday] ?? 0;
    const weekStart = currentDayStart - weekdayOffset * 24 * 60 * 60 * 1000;
    return timestamp >= weekStart && timestamp < weekStart + 7 * 24 * 60 * 60 * 1000;
  }
  const currentParts = shanghaiParts(now);
  if (!currentParts) return false;
  const year = Number(currentParts.year);
  const month = Number(currentParts.month);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const monthStart = Date.parse(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+08:00`);
  const nextMonthStart = Date.parse(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+08:00`);
  return timestamp >= monthStart && timestamp < nextMonthStart;
}

export function timeRangeLabel(filter: TimeRangeFilter) {
  return {
    all: "全部时间",
    today: "今日",
    week: "本周",
    month: "本月",
    custom: "自定义时间段",
  }[filter.preset];
}
