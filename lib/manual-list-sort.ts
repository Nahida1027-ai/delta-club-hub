export type ListSortMode = "time" | "manual";

export const ORDER_LIST_SORT_MODE_KEY = "delta-club:order-list-sort-mode";
export const SETTLEMENT_LIST_SORT_MODE_KEY = "delta-club:settlement-list-sort-mode";

/** 排序模式是设备级展示偏好；实际排序索引仍由 D1 订单/结算记录持久化。 */
export function readListSortMode(storageKey: string): ListSortMode {
  if (typeof window === "undefined") return "time";
  try {
    return window.localStorage.getItem(storageKey) === "manual" ? "manual" : "time";
  } catch {
    return "time";
  }
}

export function saveListSortMode(storageKey: string, mode: ListSortMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, mode);
  } catch {
    // 私密浏览等场景下仍可用当前页面状态，不阻断列表展示。
  }
}

/** 已排序项目优先；新建或旧数据的 null 索引固定排到时间序的最后。 */
export function sortByManualIndex<T extends { manual_sort_index?: number | null }>(
  items: T[],
  fallbackCompare: (left: T, right: T) => number,
) {
  return [...items].sort((left, right) => {
    const leftIndex = left.manual_sort_index;
    const rightIndex = right.manual_sort_index;
    const leftHasIndex = Number.isInteger(leftIndex);
    const rightHasIndex = Number.isInteger(rightIndex);
    if (leftHasIndex && rightHasIndex && leftIndex !== rightIndex) {
      return (leftIndex as number) - (rightIndex as number);
    }
    if (leftHasIndex !== rightHasIndex) return leftHasIndex ? -1 : 1;
    return fallbackCompare(left, right);
  });
}
