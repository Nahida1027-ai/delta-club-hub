"use client";

import { create } from "zustand";
import type {
  ClubData,
  Folder,
  Order,
  OrderPricingSnapshot,
  PriceMenuItem,
  SettlementPeriod,
  SettlementRecord,
  SettlementResult,
  SpecialRequirement,
  TipsByWorker,
  Worker,
  WorkerGender,
  WorkerSettlementConfig,
  WorkerTier,
  WorkerType,
} from "@/lib/club-types";
import {
  DEFAULT_SETTLEMENT_REMINDER_HOURS,
  defaultSettlementConfig,
  isSettlementOverdue,
  normalizeSettlementIntervalDays,
  normalizeSettlementReminderHours,
} from "@/lib/payroll-settlement";
import {
  buildPayoutWeights,
  calculateOrderBasePrice,
  calculateSettlement,
  calculateSettlementWithTransferFees,
  defaultTierCommissionRates,
  fromCents,
  normalizeSpecialRequirements,
  normalizeCompanionHours,
  normalizeOrderType,
  normalizeTipsByWorker,
  specialRequirementsTotal,
  tipsByWorkerTotal,
  toCents,
  validateMenuRule,
} from "@/lib/settlement";
import { getDescendantFolderIds, isDescendant } from "@/lib/folder-tree";
import {
  isWorkerEligibleForMenuItem,
  isWorkerEligibleForRule,
} from "@/lib/worker-eligibility";
import { normalizeWorkerGender } from "@/lib/worker-profile";
import {
  deriveWorkerOrderEarnings,
  resolveWorkerTipEarnings,
} from "@/lib/order-earnings";
import { aggregateTransferFees } from "@/lib/transfer-fees";
import {
  calculateDiscountedOrderTotals,
  createDefaultOrderNo,
  normalizeCustomOrderNo,
  normalizeOptionalPercentage,
} from "@/lib/order-presentation";

interface ApiData extends ClubData {
  created_order_id?: string;
  created_worker?: Worker;
  created_menu_item?: PriceMenuItem;
  new_order_id?: string;
  new_worker_id?: string;
  settlement?: SettlementResult;
  created_settlement_id?: string;
  created_period_id?: string;
}

interface ReassignmentResult {
  orderId: string;
  newWorkerId: string;
  newWorkerName: string;
}

type MenuItemInput = Omit<PriceMenuItem, "id" | "folderId" | "order"> &
  Partial<Pick<PriceMenuItem, "folderId" | "order">>;

interface ClubStore extends ClubData {
  is_loading: boolean;
  is_ready: boolean;
  is_mutating: boolean;
  error: string | null;
  last_synced_at: string | null;
  load: () => Promise<void>;
  addWorker: (data: { name: string; gender: WorkerGender; tier: WorkerTier | null; workerType?: WorkerType }) => Promise<Worker>;
  addMenuItem: (data: MenuItemInput) => Promise<PriceMenuItem>;
  updateWorker: (id: string, data: {
    name: string;
    gender: WorkerGender;
    tier: WorkerTier | null;
    workerType: WorkerType;
    settlement_config?: Pick<WorkerSettlementConfig, "interval_days" | "reminder_hours">;
  }) => Promise<void>;
  deleteWorker: (id: string) => Promise<void>;
  deleteHistoricalOrder: (orderId: string) => Promise<void>;
  replaceWorkerWithFee: (
    orderId: string,
    oldWorkerId: string,
    newWorkerId: string,
    transferFee: number,
  ) => Promise<ReassignmentResult>;
  updateMenuItem: (item: PriceMenuItem) => Promise<void>;
  deleteMenuItem: (menuItemId: string) => Promise<void>;
  reorderWorkers: (newOrder: string[]) => Promise<void>;
  reorderMenuItems: (newOrder: string[]) => Promise<void>;
  reorderFolders: (parentId: string | null, newOrder: string[]) => Promise<void>;
  /** 仅更新订单列表的手动展示顺序，不影响财务与结算。 */
  reorderOrders: (newOrderIds: string[]) => Promise<void>;
  /** 仅更新结算记录列表的手动展示顺序，不影响已发放状态与金额。 */
  reorderSettlements: (newOrderIds: string[]) => Promise<void>;
  resetOrderSort: () => Promise<void>;
  resetSettlementSort: () => Promise<void>;
  addFolder: (name: string, parentId: string | null) => Promise<Folder>;
  renameFolder: (folderId: string, newName: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  moveItemToFolder: (itemId: string, folderId: string | null) => Promise<void>;
  moveFolderToFolder: (folderId: string, targetParentId: string | null) => Promise<void>;
  createOrder: (
    menuItemId: string,
    workerIds: string[],
    specialRequirements?: SpecialRequirement[],
    hours?: number,
    customOrderNo?: string,
    overrideCommissionRate?: number | null,
    overrideDiscount?: number | null,
  ) => Promise<string>;
  updateOrderTimeAndNo: (
    orderId: string,
    data: {
      custom_order_no: string;
      display_created_at: string;
      display_completed_at: string | null;
    },
  ) => Promise<void>;
  finishOrder: (orderId: string, tipsByWorker: TipsByWorker) => Promise<SettlementResult>;
  ensureActivePeriodForWorker: (workerId: string) => Promise<SettlementPeriod>;
  settleWorkerPeriod: (workerId: string, endedAt: number) => Promise<SettlementRecord>;
  deleteSettlementRecord: (settlementId: string) => Promise<void>;
  deleteSettlementPeriod: (periodId: string) => Promise<void>;
  getOverdueSettlements: (fallbackHours?: number) => SettlementRecord[];
  markSettlementPaid: (settlementId: string, note?: string) => Promise<void>;
  updateSettlementNote: (settlementId: string, note: string) => Promise<void>;
  updateWorkerSettlementConfig: (
    workerId: string,
    config: Pick<WorkerSettlementConfig, "interval_days" | "reminder_hours">,
  ) => Promise<void>;
}

async function apiRequest(body?: Record<string, unknown>): Promise<ApiData> {
  const response = await fetch("/api/club", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await response.json()) as ApiData & { error?: string };
  if (!response.ok) throw new Error(result.error || "数据服务暂时不可用");
  return result;
}

function getSelectedWorkers(workers: Worker[], workerIds: string[]) {
  const byId = new Map(workers.map((worker) => [worker.id, worker]));
  const selected = workerIds.map((id) => byId.get(id)).filter(Boolean) as Worker[];
  if (selected.length !== workerIds.length) throw new Error("所选打手不存在");
  return selected;
}

function decrementCompletionCounts(workers: Worker[], removedOrders: Order[]) {
  const decrements = new Map<string, number>();
  const tipDeductions = new Map<string, number>();
  removedOrders
    .filter((order) => order.status === "completed")
    .forEach((order) => {
      new Set(order.assigned_worker_ids).forEach((workerId) => {
        decrements.set(workerId, (decrements.get(workerId) ?? 0) + 1);
      });
      Object.entries(resolveWorkerTipEarnings(order)).forEach(([workerId, amount]) => {
        tipDeductions.set(
          workerId,
          fromCents(toCents(tipDeductions.get(workerId) ?? 0) + toCents(amount)),
        );
      });
    });

  return workers.map((worker) => ({
    ...worker,
    total_completed_orders: Math.max(
      0,
      worker.total_completed_orders - (decrements.get(worker.id) ?? 0),
    ),
    total_tip_earnings: fromCents(
      Math.max(
        0,
        toCents(worker.total_tip_earnings) - toCents(tipDeductions.get(worker.id) ?? 0),
      ),
    ),
  }));
}

function validateWorkerType(value: unknown): WorkerType {
  if (value === undefined || value === null || value === "standard") return "standard";
  if (value === "entertainment") return "entertainment";
  throw new Error("请选择有效打手类型");
}

function validateWorkerTier(value: unknown, workerType: WorkerType): WorkerTier | null {
  if (workerType === "entertainment") return null;
  if (value === "1档" || value === "2档" || value === "3档") return value;
  throw new Error("普通打手必须选择档位");
}

function validateFolderName(value: string) {
  const name = value.trim();
  if (!name) throw new Error("请输入文件夹名称");
  if (Array.from(name).length > 20) throw new Error("文件夹名称最多 20 个字符");
  return name;
}

function validateSettlementNote(value: string) {
  const note = value.trim();
  if (Array.from(note).length > 500) throw new Error("结算备注最多 500 个字符");
  return note;
}

function validateExactOrder(newOrder: string[], expectedIds: string[], label: string) {
  const unique = new Set(newOrder);
  if (
    unique.size !== newOrder.length ||
    newOrder.length !== expectedIds.length ||
    expectedIds.some((id) => !unique.has(id))
  ) {
    throw new Error(`${label}排序数据无效，请刷新后重试`);
  }
}

function clubSnapshot(data: ClubData): ClubData {
  return {
    workers: data.workers,
    menu: data.menu,
    folders: data.folders,
    orders: data.orders,
    settlementPeriods: data.settlementPeriods,
    settlementRecords: data.settlementRecords,
  };
}

export const useClubStore = create<ClubStore>((set, get) => ({
  workers: [],
  menu: [],
  folders: [],
  orders: [],
  settlementPeriods: [],
  settlementRecords: [],
  is_loading: false,
  is_ready: false,
  is_mutating: false,
  error: null,
  last_synced_at: null,

  load: async () => {
    if (get().is_loading) return;
    set({ is_loading: true, error: null });
    try {
      const data = await apiRequest();
      set({
        workers: data.workers,
        menu: data.menu,
        folders: data.folders,
        orders: data.orders,
        settlementPeriods: data.settlementPeriods,
        settlementRecords: data.settlementRecords,
        is_loading: false,
        is_ready: true,
        last_synced_at: new Date().toISOString(),
      });
    } catch (error) {
      set({
        is_loading: false,
        is_ready: true,
        error: error instanceof Error ? error.message : "数据加载失败",
      });
    }
  },

  addWorker: async (data) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const name = data.name.trim();
    if (!name) throw new Error("请输入打手姓名");
    if (Array.from(name).length > 20) throw new Error("打手姓名最多 20 个字符");
    const workerType = validateWorkerType(data.workerType);
    const gender = normalizeWorkerGender(data.gender);
    const tier = validateWorkerTier(data.tier, workerType);
    if (
      state.workers.some(
        (worker) => worker.name.trim().toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"),
      )
    ) {
      throw new Error("已存在同名打手，请使用其他姓名");
    }

    const joinedAt = Date.now();
    const settlementConfig = defaultSettlementConfig();
    const worker: Worker = {
      id: crypto.randomUUID(),
      name,
      gender,
      tier,
      workerType,
      order: state.workers.length
        ? Math.max(...state.workers.map((current) => current.order)) + 1
        : 0,
      status: "idle",
      total_completed_orders: 0,
      total_tip_earnings: 0,
      joined_at: joinedAt,
      settlement_config: settlementConfig,
      active_period_id: null,
    };
    const previous = clubSnapshot(state);
    set({
      workers: [...state.workers, worker],
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "add_worker", worker });
      const createdWorker =
        result.workers.find((candidate) => candidate.id === worker.id) ??
        result.created_worker ??
        worker;
      set({
        ...result,
        workers: [
          ...result.workers.filter((candidate) => candidate.id !== createdWorker.id),
          createdWorker,
        ],
        is_mutating: false,
        last_synced_at: new Date().toISOString(),
      });
      return createdWorker;
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  addMenuItem: async (data) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const orderType = normalizeOrderType(data.order_type);
    const item: PriceMenuItem = {
      ...data,
      id: crypto.randomUUID(),
      service_name: data.service_name.trim(),
      folderId: data.folderId ?? null,
      order: state.menu.filter((current) => current.folderId === (data.folderId ?? null)).length
        ? Math.max(
            ...state.menu
              .filter((current) => current.folderId === (data.folderId ?? null))
              .map((current) => current.order),
          ) + 1
        : 0,
      order_type: orderType,
      base_price: orderType === "escort" ? data.base_price : 0,
      hourly_rate: orderType === "companion" ? data.hourly_rate : 0,
      commission_mode: data.commission_mode ?? "uniform",
      tier_commission_rates: {
        ...(data.tier_commission_rates ?? defaultTierCommissionRates()),
      },
      tiered_ratios:
        data.split_type === "tiered" && data.tiered_ratios
          ? { ...data.tiered_ratios }
          : null,
      eligible_tiers:
        data.split_type === "tiered"
          ? ["1档", "2档"]
          : [...data.eligible_tiers],
    };
    if (
      item.split_type === "tiered" &&
      (!Number.isFinite(item.tiered_ratios?.["1档"]) ||
        !Number.isFinite(item.tiered_ratios?.["2档"]))
    ) {
      throw new Error("请填写有效的档位占比");
    }
    validateMenuRule(item);
    if (
      state.menu.some(
        (current) =>
          current.service_name.trim().toLocaleLowerCase("zh-CN") ===
          item.service_name.toLocaleLowerCase("zh-CN"),
      )
    ) {
      throw new Error("已存在同名服务，请使用其他名称");
    }

    const previous = clubSnapshot(state);
    set({
      menu: [...state.menu, item],
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "add_menu_item", item });
      const createdMenuItem =
        result.menu.find((candidate) => candidate.id === item.id) ??
        result.created_menu_item ??
        item;
      set({
        ...result,
        menu: [
          ...result.menu.filter((candidate) => candidate.id !== createdMenuItem.id),
          createdMenuItem,
        ],
        is_mutating: false,
        last_synced_at: new Date().toISOString(),
      });
      return createdMenuItem;
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  reorderWorkers: async (newOrder) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    validateExactOrder(newOrder, state.workers.map((worker) => worker.id), "打手");
    const orderById = new Map(newOrder.map((id, index) => [id, index]));
    const previous = clubSnapshot(state);
    set({
      workers: [...state.workers]
        .map((worker) => ({ ...worker, order: orderById.get(worker.id) ?? worker.order }))
        .sort((a, b) => a.order - b.order),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "reorder_workers", worker_ids: newOrder });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  reorderMenuItems: async (newOrder) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    if (!newOrder.length) return;
    const state = get();
    const first = state.menu.find((item) => item.id === newOrder[0]);
    if (!first) throw new Error("服务排序数据无效，请刷新后重试");
    const group = state.menu.filter((item) => item.folderId === first.folderId);
    validateExactOrder(newOrder, group.map((item) => item.id), "服务");
    const orderById = new Map(newOrder.map((id, index) => [id, index]));
    const previous = clubSnapshot(state);
    set({
      menu: state.menu
        .map((item) => orderById.has(item.id)
          ? { ...item, order: orderById.get(item.id) ?? item.order }
          : item)
        .sort((a, b) => a.order - b.order),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "reorder_menu_items", item_ids: newOrder });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  reorderFolders: async (parentId, newOrder) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const normalizedParentId = parentId ?? null;
    const siblings = state.folders.filter(
      (folder) => (folder.parentId ?? null) === normalizedParentId,
    );
    validateExactOrder(newOrder, siblings.map((folder) => folder.id), "文件夹");
    const orderById = new Map(newOrder.map((id, index) => [id, index]));
    const previous = clubSnapshot(state);
    set({
      folders: state.folders.map((folder) =>
        orderById.has(folder.id)
          ? { ...folder, order: orderById.get(folder.id) ?? folder.order }
          : folder,
      ),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({
        action: "reorder_folders",
        parent_id: normalizedParentId,
        folder_ids: newOrder,
      });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  reorderOrders: async (newOrderIds) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    validateExactOrder(newOrderIds, state.orders.map((order) => order.id), "订单");
    const indexById = new Map(newOrderIds.map((id, index) => [id, index]));
    const previous = clubSnapshot(state);
    set({
      orders: state.orders.map((order) => ({
        ...order,
        manual_sort_index: indexById.get(order.id) ?? order.manual_sort_index ?? null,
      })),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "reorder_orders", order_ids: newOrderIds });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  reorderSettlements: async (newOrderIds) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    validateExactOrder(
      newOrderIds,
      state.settlementRecords.map((record) => record.id),
      "结算记录",
    );
    const indexById = new Map(newOrderIds.map((id, index) => [id, index]));
    const previous = clubSnapshot(state);
    set({
      settlementRecords: state.settlementRecords.map((record) => ({
        ...record,
        manual_sort_index: indexById.get(record.id) ?? record.manual_sort_index ?? null,
      })),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({
        action: "reorder_settlements",
        settlement_ids: newOrderIds,
      });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  resetOrderSort: async () => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const previous = clubSnapshot(state);
    set({
      orders: state.orders.map((order) => ({ ...order, manual_sort_index: null })),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "reset_order_sort" });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  resetSettlementSort: async () => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const previous = clubSnapshot(state);
    set({
      settlementRecords: state.settlementRecords.map((record) => ({
        ...record,
        manual_sort_index: null,
      })),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "reset_settlement_sort" });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  addFolder: async (value, parentId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const name = validateFolderName(value);
    const normalizedParentId = parentId ?? null;
    if (
      normalizedParentId !== null &&
      !state.folders.some((folder) => folder.id === normalizedParentId)
    ) {
      throw new Error("父文件夹不存在");
    }
    if (state.folders.some((folder) =>
      (folder.parentId ?? null) === normalizedParentId &&
      folder.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN")
    )) {
      throw new Error("同一层级已存在同名文件夹");
    }
    const siblings = state.folders.filter(
      (folder) => (folder.parentId ?? null) === normalizedParentId,
    );
    const folder: Folder = {
      id: crypto.randomUUID(),
      name,
      parentId: normalizedParentId,
      order: siblings.length ? Math.max(...siblings.map((item) => item.order)) + 1 : 0,
      createdAt: Date.now(),
    };
    const previous = clubSnapshot(state);
    set({ folders: [...state.folders, folder], is_mutating: true, error: null });
    try {
      const result = await apiRequest({ action: "add_folder", folder });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
      return result.folders.find((item) => item.id === folder.id) ?? folder;
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  renameFolder: async (folderId, value) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const name = validateFolderName(value);
    const target = state.folders.find((folder) => folder.id === folderId);
    if (!target) throw new Error("未找到该文件夹");
    if (state.folders.some((folder) =>
      folder.id !== folderId &&
      (folder.parentId ?? null) === (target.parentId ?? null) &&
      folder.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN")
    )) {
      throw new Error("同一层级已存在同名文件夹");
    }
    const previous = clubSnapshot(state);
    set({
      folders: state.folders.map((folder) => folder.id === folderId ? { ...folder, name } : folder),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "rename_folder", folder_id: folderId, name });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  deleteFolder: async (folderId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    if (!state.folders.some((folder) => folder.id === folderId)) throw new Error("未找到该文件夹");
    const descendantIds = getDescendantFolderIds(state.folders, folderId);
    const subtreeIds = new Set([folderId, ...descendantIds]);
    const rootItems = state.menu.filter((item) => item.folderId === null);
    const nextRootOrder = rootItems.length ? Math.max(...rootItems.map((item) => item.order)) + 1 : 0;
    const movedItems = state.menu
      .filter((item) => item.folderId !== null && subtreeIds.has(item.folderId))
      .sort((a, b) =>
        (a.folderId ?? "").localeCompare(b.folderId ?? "") ||
        a.order - b.order ||
        a.service_name.localeCompare(b.service_name, "zh-CN"),
      );
    const movedOrderById = new Map(movedItems.map((item, index) => [item.id, nextRootOrder + index]));
    const rootFolders = state.folders.filter((folder) => (folder.parentId ?? null) === null);
    const nextRootFolderOrder = rootFolders.length
      ? Math.max(...rootFolders.map((folder) => folder.order)) + 1
      : 0;
    const descendants = state.folders
      .filter((folder) => descendantIds.includes(folder.id))
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    const descendantOrderById = new Map(
      descendants.map((folder, index) => [folder.id, nextRootFolderOrder + index]),
    );
    const previous = clubSnapshot(state);
    set({
      folders: state.folders
        .filter((folder) => folder.id !== folderId)
        .map((folder) => descendantOrderById.has(folder.id)
          ? {
              ...folder,
              parentId: null,
              order: descendantOrderById.get(folder.id) ?? folder.order,
            }
          : folder),
      menu: state.menu.map((item) => movedOrderById.has(item.id)
        ? { ...item, folderId: null, order: movedOrderById.get(item.id) ?? item.order }
        : item),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "delete_folder", folder_id: folderId });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  moveItemToFolder: async (itemId, folderId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const item = state.menu.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("未找到该服务项目");
    if (folderId !== null && !state.folders.some((folder) => folder.id === folderId)) {
      throw new Error("目标文件夹不存在");
    }
    if (item.folderId === folderId) return;
    const targetItems = state.menu.filter((candidate) => candidate.folderId === folderId);
    const nextOrder = targetItems.length ? Math.max(...targetItems.map((candidate) => candidate.order)) + 1 : 0;
    const previous = clubSnapshot(state);
    set({
      menu: state.menu.map((candidate) => candidate.id === itemId
        ? { ...candidate, folderId, order: nextOrder }
        : candidate),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "move_item_to_folder", item_id: itemId, folder_id: folderId });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  moveFolderToFolder: async (folderId, targetParentId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const folder = state.folders.find((candidate) => candidate.id === folderId);
    if (!folder) throw new Error("未找到该文件夹");
    const normalizedParentId = targetParentId ?? null;
    if (
      normalizedParentId !== null &&
      !state.folders.some((candidate) => candidate.id === normalizedParentId)
    ) {
      throw new Error("目标文件夹不存在");
    }
    if (normalizedParentId === folderId || isDescendant(state.folders, folderId, normalizedParentId)) {
      throw new Error("不能把文件夹移动到自身或其子文件夹中");
    }
    if ((folder.parentId ?? null) === normalizedParentId) return;
    if (state.folders.some((candidate) =>
      candidate.id !== folderId &&
      (candidate.parentId ?? null) === normalizedParentId &&
      candidate.name.toLocaleLowerCase("zh-CN") === folder.name.toLocaleLowerCase("zh-CN")
    )) {
      throw new Error("目标层级已存在同名文件夹");
    }

    const siblings = state.folders.filter(
      (candidate) => (candidate.parentId ?? null) === normalizedParentId,
    );
    const nextOrder = siblings.length
      ? Math.max(...siblings.map((candidate) => candidate.order)) + 1
      : 0;
    const previous = clubSnapshot(state);
    set({
      folders: state.folders.map((candidate) =>
        candidate.id === folderId
          ? { ...candidate, parentId: normalizedParentId, order: nextOrder }
          : candidate,
      ),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({
        action: "move_folder_to_folder",
        folder_id: folderId,
        target_parent_id: normalizedParentId,
      });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  updateWorker: async (id, data) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const worker = state.workers.find((candidate) => candidate.id === id);
    if (!worker) throw new Error("未找到该打手");
    const name = data.name.trim();
    if (!name) throw new Error("请输入打手姓名");
    if (Array.from(name).length > 20) throw new Error("打手姓名最多 20 个字符");
    const workerType = validateWorkerType(data.workerType);
    const gender = data.gender === undefined
      ? normalizeWorkerGender(worker.gender)
      : normalizeWorkerGender(data.gender);
    const tier = validateWorkerTier(data.tier, workerType);
    if (
      worker.status === "busy" &&
      (tier !== worker.tier || workerType !== worker.workerType)
    ) {
      throw new Error("该打手正在接单，只能修改姓名、性别和结算配置");
    }
    const settlementConfig = data.settlement_config
      ? {
          ...worker.settlement_config,
          interval_days: normalizeSettlementIntervalDays(
            data.settlement_config.interval_days,
          ),
          reminder_hours: normalizeSettlementReminderHours(
            data.settlement_config.reminder_hours,
          ),
        }
      : worker.settlement_config;

    const previous = clubSnapshot(state);
    set({
      workers: state.workers.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              name,
              gender,
              tier,
              workerType,
              settlement_config: settlementConfig,
            }
          : candidate,
      ),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({
        action: "update_worker",
        worker_id: id,
        data: {
          name,
          gender,
          tier,
          workerType,
          ...(data.settlement_config
            ? {
                settlement_config: {
                  interval_days: settlementConfig.interval_days,
                  reminder_hours: settlementConfig.reminder_hours,
                },
              }
            : {}),
        },
      });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  deleteWorker: async (id) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const worker = state.workers.find((candidate) => candidate.id === id);
    if (!worker) throw new Error("未找到该打手");
    if (worker.status === "busy") throw new Error("该打手正在接单，无法删除");
    if (
      state.settlementRecords.some(
        (record) => record.worker_id === id && record.status === "pending",
      )
    ) {
      throw new Error("该打手有待发放结算，请先处理");
    }

    const removedOrders = state.orders.filter(
      (order) =>
        order.assigned_worker_ids.includes(id) ||
        (order.transfer_fees ?? []).some((record) => record.to_worker_id === id),
    );
    if (removedOrders.some((order) => order.status === "active")) {
      throw new Error("该打手仍关联进行中的转单，无法删除");
    }
    // 删除关联订单时，订单工资和即时打赏都会从实时汇总中移除；
    // 待发放记录只回退订单工资，打赏从累计即时打赏中扣除。
    const previous = clubSnapshot(state);
    set({
      workers: decrementCompletionCounts(
        state.workers.filter((candidate) => candidate.id !== id),
        removedOrders,
      ),
      orders: state.orders.filter((order) => !removedOrders.includes(order)),
      settlementRecords: state.settlementRecords.map((record) => {
        if (record.status !== "pending") return record;
        const removedIds = new Set(removedOrders.map((order) => order.id));
        if (!record.order_ids.some((orderId) => removedIds.has(orderId))) return record;
        const order_details = record.order_details.filter(
          (detail) => !removedIds.has(detail.order_id),
        );
        const order_ids = record.order_ids.filter((orderId) => !removedIds.has(orderId));
        return {
          ...record,
          order_ids,
          order_details,
          total_orders: order_ids.length,
          total_amount: fromCents(
            order_details.reduce((sum, detail) => sum + toCents(detail.worker_amount), 0),
          ),
        };
      }),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "delete_worker", worker_id: id });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  deleteHistoricalOrder: async (orderId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order || order.status !== "completed") {
      throw new Error("只允许删除已完成的历史订单");
    }

    const previous = clubSnapshot(state);
    // 删除整条历史订单会同时移除订单工资、即时打赏与俱乐部抽成；
    // 工资周期只回退订单工资，打赏不参与周期金额。
    set({
      workers: decrementCompletionCounts(state.workers, [order]),
      orders: state.orders.filter((candidate) => candidate.id !== orderId),
      settlementRecords: state.settlementRecords.map((record) => {
        if (record.status !== "pending" || !record.order_ids.includes(orderId)) {
          return record;
        }
        const order_ids = record.order_ids.filter((id) => id !== orderId);
        const order_details = record.order_details.filter(
          (detail) => detail.order_id !== orderId,
        );
        return {
          ...record,
          order_ids,
          order_details,
          total_orders: order_ids.length,
          total_amount: fromCents(
            order_details.reduce((sum, detail) => sum + toCents(detail.worker_amount), 0),
          ),
        };
      }),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "delete_historical_order", order_id: orderId });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  replaceWorkerWithFee: async (orderId, oldWorkerId, newWorkerId, transferFeeValue) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order || order.status !== "active") throw new Error("订单已结束或不存在");
    const oldWorker = state.workers.find((worker) => worker.id === oldWorkerId);
    if (!oldWorker || oldWorker.status !== "busy") throw new Error("原打手当前不在接单");
    if (!order.assigned_worker_ids.includes(oldWorkerId)) {
      throw new Error("该打手不属于当前订单");
    }
    const replacement = state.workers.find((worker) => worker.id === newWorkerId);
    if (!replacement || replacement.status !== "idle") {
      throw new Error("所选新打手当前不是空闲状态");
    }
    if (order.assigned_worker_ids.includes(replacement.id)) {
      throw new Error("所选打手已经在本订单中");
    }
    const transferFee = fromCents(toCents(Number(transferFeeValue)));
    const oldWeight = order.pricing_snapshot.payout_weights.find(
      (entry) => entry.workerId === oldWorkerId,
    );
    if (!oldWeight) throw new Error("订单缺少该打手的分配权重");
    const menuItem = state.menu.find((item) => item.id === order.menu_item_id);
    if (!menuItem) throw new Error("服务项目不存在");
    const assignmentRule = {
      commission_mode: order.pricing_snapshot.commission_mode,
      split_type: order.pricing_snapshot.split_type,
      eligible_tiers:
        order.pricing_snapshot.split_type === "tiered" && oldWeight.tier
          ? [oldWeight.tier]
          : menuItem.eligible_tiers,
    };
    if (!isWorkerEligibleForRule(assignmentRule, replacement)) {
      throw new Error("所选新打手不符合该订单的档位或抽成规则");
    }

    const assignedWorkerIds = order.assigned_worker_ids.map((workerId) =>
      workerId === oldWorkerId ? replacement.id : workerId,
    );
    const pricingSnapshot: OrderPricingSnapshot = {
      ...order.pricing_snapshot,
      payout_weights: order.pricing_snapshot.payout_weights.map((entry) =>
        entry.workerId === oldWorkerId
          ? {
              ...entry,
              workerId: replacement.id,
              workerName: replacement.name,
              workerType: replacement.workerType,
              tier: replacement.tier,
            }
          : entry,
      ),
    };
    const changedAt = new Date().toISOString();
    const transferFees = [
      ...(order.transfer_fees ?? []),
      {
        id: crypto.randomUUID(),
        fee: transferFee,
        to_worker_id: replacement.id,
        to_worker_name_snapshot: replacement.name,
        from_worker_id: oldWorker.id,
        from_worker_name_snapshot: oldWorker.name,
        created_at: Date.parse(changedAt),
      },
    ];
    // 转单费以明细数组为权威来源；汇总映射仅供工资计算与旧数据兼容。
    const transferFeesByWorker = aggregateTransferFees(transferFees);
    calculateSettlementWithTransferFees(
      pricingSnapshot,
      {},
      order.order_original_total,
      transferFeesByWorker,
    );

    const optimisticPeriodId = replacement.active_period_id ?? `period-reassign-${Date.now()}`;
    const optimisticPeriodIds = { ...order.settlement_period_ids_by_worker };
    if ((transferFeesByWorker[oldWorkerId] ?? 0) <= 0) {
      delete optimisticPeriodIds[oldWorkerId];
    }
    optimisticPeriodIds[replacement.id] = optimisticPeriodId;
    const optimisticOrder: Order = {
      ...order,
      assigned_worker_ids: assignedWorkerIds,
      transfer_fees_by_worker: transferFeesByWorker,
      transfer_fees: transferFees,
      reassignment_history: [
        ...(order.reassignment_history ?? []),
        {
          changed_at: changedAt,
          old_worker_id: oldWorker.id,
          old_worker_name: oldWorker.name,
          new_worker_id: replacement.id,
          new_worker_name: replacement.name,
          transfer_fee: transferFee,
        },
      ],
      settled: false,
      settlement_id: null,
      settlement_ids_by_worker: {},
      settlement_period_id:
        optimisticPeriodIds[assignedWorkerIds[0]] ?? null,
      settlement_period_ids_by_worker: optimisticPeriodIds,
      pricing_snapshot: pricingSnapshot,
    };
    const previous = clubSnapshot(state);
    set({
      workers: state.workers.map((worker) => {
        if (worker.id === oldWorkerId) return { ...worker, status: "idle" };
        if (worker.id === replacement.id) {
          return { ...worker, status: "busy", active_period_id: optimisticPeriodId };
        }
        return worker;
      }),
      settlementPeriods: replacement.active_period_id
        ? state.settlementPeriods
        : [
            ...state.settlementPeriods,
            {
              id: optimisticPeriodId,
              worker_id: replacement.id,
              started_at: Date.parse(changedAt),
              ended_at: null,
              status: "active",
              settlement_record_id: null,
            },
          ],
      orders: state.orders.map((candidate) =>
        candidate.id === orderId ? optimisticOrder : candidate,
      ),
      is_mutating: true,
      error: null,
    });

    try {
      const result = await apiRequest({
        action: "replace_worker_with_fee",
        order_id: orderId,
        old_worker_id: oldWorkerId,
        new_worker_id: replacement.id,
        transfer_fee: transferFee,
      });
      const newWorkerId = result.new_worker_id ?? replacement.id;
      const newWorkerName =
        result.workers.find((worker) => worker.id === newWorkerId)?.name ?? replacement.name;
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
      return {
        orderId: result.new_order_id ?? orderId,
        newWorkerId,
        newWorkerName,
      };
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  updateMenuItem: async (item) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const orderType = normalizeOrderType(item.order_type);
    const normalizedItem: PriceMenuItem = {
      ...item,
      service_name: item.service_name.trim(),
      order_type: orderType,
      base_price: orderType === "escort" ? item.base_price : 0,
      hourly_rate: orderType === "companion" ? item.hourly_rate : 0,
      commission_mode: item.commission_mode ?? "uniform",
      tier_commission_rates: {
        ...(item.tier_commission_rates ?? defaultTierCommissionRates()),
      },
      tiered_ratios:
        item.split_type === "tiered" && item.tiered_ratios
          ? { ...item.tiered_ratios }
          : null,
      eligible_tiers:
        item.split_type === "tiered" ? ["1档", "2档"] : [...item.eligible_tiers],
    };
    validateMenuRule(normalizedItem);
    const previous = clubSnapshot(get());
    set((state) => ({
      menu: state.menu.map((current) =>
        current.id === normalizedItem.id ? normalizedItem : current,
      ),
      is_mutating: true,
      error: null,
    }));
    try {
      const data = await apiRequest({ action: "update_menu", item: normalizedItem });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  deleteMenuItem: async (menuItemId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const item = state.menu.find((candidate) => candidate.id === menuItemId);
    if (!item) throw new Error("未找到该服务项目");
    if (
      state.orders.some(
        (order) => order.status === "active" && order.menu_item_id === menuItemId,
      )
    ) {
      throw new Error("该服务有正在进行的订单，无法删除，请先完结订单");
    }

    const previous = clubSnapshot(state);
    set({
      menu: state.menu.filter((candidate) => candidate.id !== menuItemId),
      is_mutating: true,
      error: null,
    });
    try {
      const data = await apiRequest({
        action: "delete_menu_item",
        menu_item_id: menuItemId,
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  createOrder: async (
    menuItemId,
    workerIds,
    specialRequirements = [],
    hours,
    customOrderNo,
    overrideCommissionRate,
    overrideDiscount,
  ) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const menuItem = state.menu.find((item) => item.id === menuItemId);
    if (!menuItem) throw new Error("服务项目不存在");
    const selectedWorkers = getSelectedWorkers(state.workers, workerIds);
    if (selectedWorkers.some((worker) => worker.status !== "idle")) {
      throw new Error("所选打手已被占用");
    }
    if (selectedWorkers.some((worker) => !isWorkerEligibleForMenuItem(menuItem, worker))) {
      throw new Error("所选打手不符合该服务的档位或抽成规则");
    }
    const payoutWeights = buildPayoutWeights(
      menuItem.split_type,
      selectedWorkers,
      menuItem.tiered_ratios,
    );
    const normalizedRequirements = normalizeSpecialRequirements(specialRequirements);
    const specialTotal = specialRequirementsTotal(normalizedRequirements);
    const normalizedOverrideCommissionRate = normalizeOptionalPercentage(
      overrideCommissionRate,
      "临时抽成",
    );
    const normalizedOverrideDiscount = normalizeOptionalPercentage(
      overrideDiscount,
      "临时折扣",
    );
    const orderType = normalizeOrderType(menuItem.order_type);
    const orderHours = orderType === "companion"
      ? normalizeCompanionHours(hours ?? 1)
      : null;
    const hourlyRateSnapshot = orderType === "companion"
      ? menuItem.hourly_rate
      : null;
    const basePriceSnapshot = calculateOrderBasePrice(
      menuItem,
      orderHours ?? 1,
    );
    const discountedTotals = calculateDiscountedOrderTotals(
      basePriceSnapshot,
      specialTotal,
      normalizedOverrideDiscount,
    );
    const orderOriginalTotal = discountedTotals.totalPrice;
    toCents(orderOriginalTotal);
    const snapshot: OrderPricingSnapshot = {
      service_name: menuItem.service_name,
      order_type: orderType,
      hourly_rate: hourlyRateSnapshot ?? 0,
      base_price: basePriceSnapshot,
      commission_mode: menuItem.commission_mode,
      club_commission_rate: menuItem.club_commission_rate,
      tier_commission_rates: { ...menuItem.tier_commission_rates },
      override_commission_rate: normalizedOverrideCommissionRate,
      split_type: menuItem.split_type,
      tiered_ratios: menuItem.tiered_ratios,
      payout_weights: payoutWeights,
    };
    calculateSettlement(snapshot, {}, orderOriginalTotal);
    const createdAt = new Date().toISOString();
    const normalizedOrderNo = customOrderNo === undefined
      ? createDefaultOrderNo(createdAt)
      : normalizeCustomOrderNo(customOrderNo);
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticPeriodIds = Object.fromEntries(
      selectedWorkers.flatMap((worker) =>
        worker.active_period_id ? [[worker.id, worker.active_period_id]] : [],
      ),
    );
    const optimisticOrder: Order = {
      id: optimisticId,
      manual_sort_index: null,
      menu_item_id: menuItemId,
      assigned_worker_ids: workerIds,
      order_type: orderType,
      hours: orderHours,
      hourly_rate_snapshot: hourlyRateSnapshot,
      split_type: menuItem.split_type,
      status: "active",
      tip: 0,
      tips_by_worker: {},
      worker_order_earnings: {},
      worker_tip_earnings: {},
      transfer_fees_by_worker: {},
      transfer_fees: [],
      reassignment_history: [],
      final_club_income: null,
      final_worker_incomes: [],
      special_requirements: normalizedRequirements,
      base_price_snapshot: basePriceSnapshot,
      special_total: specialTotal,
      total_price: orderOriginalTotal,
      order_original_total: orderOriginalTotal,
      original_total_before_discount: discountedTotals.originalTotalBeforeDiscount,
      discount_amount: discountedTotals.discountAmount,
      override_commission_rate: normalizedOverrideCommissionRate,
      override_discount: discountedTotals.overrideDiscount,
      custom_order_no: normalizedOrderNo,
      created_at: createdAt,
      display_created_at: createdAt,
      completed_at: null,
      display_completed_at: null,
      pricing_snapshot: snapshot,
      settled: false,
      settlement_id: null,
      settlement_ids_by_worker: {},
      settlement_period_id: optimisticPeriodIds[workerIds[0]] ?? null,
      settlement_period_ids_by_worker: optimisticPeriodIds,
    };
    const previous = clubSnapshot(state);
    set({
      workers: state.workers.map((worker) =>
        workerIds.includes(worker.id) ? { ...worker, status: "busy" } : worker,
      ),
      orders: [optimisticOrder, ...state.orders],
      is_mutating: true,
      error: null,
    });
    try {
      const data = await apiRequest({
        action: "create_order",
        menu_item_id: menuItemId,
        assigned_worker_ids: workerIds,
        special_requirements: normalizedRequirements,
        hours: orderHours,
        custom_order_no: normalizedOrderNo,
        override_commission_rate: normalizedOverrideCommissionRate,
        override_discount: discountedTotals.overrideDiscount,
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
      return data.created_order_id ?? optimisticId;
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  updateOrderTimeAndNo: async (orderId, data) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order) throw new Error("订单不存在");
    const customOrderNo = normalizeCustomOrderNo(data.custom_order_no);
    const createdTimestamp = Date.parse(data.display_created_at);
    const completedTimestamp = data.display_completed_at
      ? Date.parse(data.display_completed_at)
      : null;
    if (!Number.isFinite(createdTimestamp)) throw new Error("下单时间格式无效");
    if (completedTimestamp !== null && !Number.isFinite(completedTimestamp)) {
      throw new Error("完成时间格式无效");
    }
    const displayCreatedAt = new Date(createdTimestamp).toISOString();
    const displayCompletedAt = completedTimestamp === null
      ? null
      : new Date(completedTimestamp).toISOString();
    if (displayCompletedAt && Date.parse(displayCompletedAt) < Date.parse(displayCreatedAt)) {
      throw new Error("完成时间不能早于下单时间");
    }
    if (order.status === "completed" && !displayCompletedAt) {
      throw new Error("已完成订单需要保留完成时间");
    }

    const previous = clubSnapshot(state);
    set({
      orders: state.orders.map((candidate) =>
        candidate.id === orderId
          ? {
              ...candidate,
              custom_order_no: customOrderNo,
              display_created_at: displayCreatedAt,
              display_completed_at: displayCompletedAt,
            }
          : candidate,
      ),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({
        action: "update_order_presentation",
        order_id: orderId,
        custom_order_no: customOrderNo,
        display_created_at: displayCreatedAt,
        display_completed_at: displayCompletedAt,
      });
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  finishOrder: async (orderId, tipsByWorker) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order || order.status !== "active") {
      throw new Error("订单已结束或不存在，未重复结算");
    }

    /*
     * finishOrder 权威公式（calculateSettlement 内部全部按整数分计算）：
     * 1. 订单总价 = order_original_total = base_price_snapshot + special_total，
     *    特殊需求与基础价一样参与抽成。
     * 2. single：打手实得 = 订单总价 × (1 - 该打手档位抽成率)。
     * 3. equal：先把订单总价平分，每名打手实得 = 自己的 1/2 份额 ×
     *    (1 - 自己档位抽成率)；俱乐部抽成 = 订单总价 - 两人基础实得之和。
     * 4. worker_order_earnings = 每名打手的基础实得 + 其转单费，只进入工资结算周期；
     *    转单费是独立工资补偿，不扣减俱乐部抽成，也不扣减被换下打手账面收入；
     *    worker_tip_earnings = tips_by_worker，100% 即时到账且永不进入周期。
     * 5. final_worker_incomes 继续保存两者之和，供总收入和历史兼容展示。
     * 6. 168 元、1档 25%、2档 20% 的 equal 单：两人各分 84 元，
     *    基础实得分别为 63 元、67.2 元，俱乐部实得 37.8 元；若仅给
     *    1档打手打赏 10 元，最终实得为 73 元、67.2 元，俱乐部仍为 37.8 元。
     */
    const normalizedTipsByWorker = normalizeTipsByWorker(
      order.pricing_snapshot,
      tipsByWorker,
    );
    const totalTip = tipsByWorkerTotal(normalizedTipsByWorker);
    const effectiveTransferFees = order.transfer_fees?.length
      ? aggregateTransferFees(order.transfer_fees)
      : order.transfer_fees_by_worker ?? {};
    const settlement = calculateSettlementWithTransferFees(
      order.pricing_snapshot,
      normalizedTipsByWorker,
      order.order_original_total,
      effectiveTransferFees,
    );
    const workerOrderEarnings = deriveWorkerOrderEarnings(
      settlement.worker_incomes,
      normalizedTipsByWorker,
    );

    const completedAt = new Date().toISOString();
    const previous = clubSnapshot(state);
    set({
      orders: state.orders.map((candidate) =>
        candidate.id === orderId
          ? {
              ...candidate,
              status: "completed",
              tip: totalTip,
              tips_by_worker: normalizedTipsByWorker,
              worker_order_earnings: workerOrderEarnings,
              worker_tip_earnings: normalizedTipsByWorker,
              final_club_income: settlement.club_income,
              final_worker_incomes: settlement.worker_incomes,
              completed_at: completedAt,
              display_completed_at: candidate.display_completed_at ?? completedAt,
            }
          : candidate,
      ),
      workers: state.workers.map((worker) =>
        order.assigned_worker_ids.includes(worker.id)
          ? {
              ...worker,
              status: "idle",
              total_completed_orders: worker.total_completed_orders + 1,
              total_tip_earnings: fromCents(
                toCents(worker.total_tip_earnings) +
                  toCents(normalizedTipsByWorker[worker.id] ?? 0),
              ),
            }
          : worker,
      ),
      is_mutating: true,
      error: null,
    });

    try {
      const data = await apiRequest({
        action: "finish_order",
        order_id: orderId,
        tips_by_worker: normalizedTipsByWorker,
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
      return data.settlement ?? settlement;
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  ensureActivePeriodForWorker: async (workerId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    if (!state.workers.some((worker) => worker.id === workerId)) {
      throw new Error("未找到该打手");
    }
    const previous = clubSnapshot(state);
    set({ is_mutating: true, error: null });
    try {
      const data = await apiRequest({
        action: "ensure_active_period_for_worker",
        worker_id: workerId,
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
      const period = data.settlementPeriods.find(
        (candidate) => candidate.id === data.created_period_id,
      );
      if (!period) throw new Error("结算周期创建后读取失败");
      return period;
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  settleWorkerPeriod: async (workerId, endedAt) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const worker = state.workers.find((candidate) => candidate.id === workerId);
    if (!worker) throw new Error("未找到该打手");
    const period = state.settlementPeriods.find(
      (candidate) => candidate.id === worker.active_period_id && candidate.status === "active",
    );
    if (!period) throw new Error("该打手暂无进行中的结算周期");
    if (!Number.isFinite(endedAt) || endedAt < period.started_at) {
      throw new Error("结算结束时间不能早于周期开始时间");
    }
    if (endedAt > Date.now()) {
      throw new Error("结算结束时间不能晚于当前时间");
    }
    const previous = clubSnapshot(state);
    set({ is_mutating: true, error: null });
    try {
      const data = await apiRequest({
        action: "settle_worker_period",
        worker_id: workerId,
        ended_at: Math.trunc(endedAt),
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
      const record = data.settlementRecords.find(
        (candidate) => candidate.id === data.created_settlement_id,
      );
      if (!record) throw new Error("结算记录生成后读取失败");
      return record;
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  deleteSettlementRecord: async (settlementId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    if (!state.settlementRecords.some((record) => record.id === settlementId)) {
      throw new Error("未找到该结算记录");
    }
    const previous = clubSnapshot(state);
    set({ is_mutating: true, error: null });
    try {
      const data = await apiRequest({
        action: "delete_settlement_record",
        settlement_id: settlementId,
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  deleteSettlementPeriod: async (periodId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const period = state.settlementPeriods.find(
      (candidate) => candidate.id === periodId && candidate.status === "active",
    );
    if (!period) throw new Error("只允许删除进行中的结算周期");
    const previous = clubSnapshot(state);
    set({
      workers: state.workers.map((worker) =>
        worker.id === period.worker_id && worker.active_period_id === periodId
          ? { ...worker, active_period_id: null }
          : worker,
      ),
      settlementPeriods: state.settlementPeriods.filter(
        (candidate) => candidate.id !== periodId,
      ),
      orders: state.orders.map((order) => {
        const mappedPeriodId = order.settlement_period_ids_by_worker?.[period.worker_id];
        if (mappedPeriodId !== periodId && order.settlement_period_id !== periodId) {
          return order;
        }
        const periodIds = { ...order.settlement_period_ids_by_worker };
        delete periodIds[period.worker_id];
        return {
          ...order,
          settled: false,
          settlement_period_id:
            order.settlement_period_id === periodId
              ? null
              : order.settlement_period_id,
          settlement_period_ids_by_worker: periodIds,
        };
      }),
      is_mutating: true,
      error: null,
    });
    try {
      const data = await apiRequest({
        action: "delete_settlement_period",
        period_id: periodId,
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  getOverdueSettlements: (fallbackHours = DEFAULT_SETTLEMENT_REMINDER_HOURS) => {
    const state = get();
    const normalizedFallback = normalizeSettlementReminderHours(fallbackHours);
    const workersById = new Map(state.workers.map((worker) => [worker.id, worker]));
    return state.settlementRecords.filter((record) =>
      isSettlementOverdue(
        record,
        workersById.get(record.worker_id)?.settlement_config.reminder_hours ??
          normalizedFallback,
      ),
    );
  },

  markSettlementPaid: async (settlementId, noteValue) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const record = state.settlementRecords.find((item) => item.id === settlementId);
    if (!record) throw new Error("未找到该结算记录");
    if (record.status !== "pending") throw new Error("该结算已发放，未重复处理");
    const note = noteValue === undefined ? record.note : validateSettlementNote(noteValue);
    const paidAt = Date.now();
    const previous = clubSnapshot(state);
    set({
      settlementRecords: state.settlementRecords.map((item) =>
        item.id === settlementId
          ? { ...item, status: "paid", paid_at: paidAt, note }
          : item,
      ),
      is_mutating: true,
      error: null,
    });
    try {
      const data = await apiRequest({
        action: "mark_settlement_paid",
        settlement_id: settlementId,
        note,
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  updateSettlementNote: async (settlementId, noteValue) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    if (!state.settlementRecords.some((record) => record.id === settlementId)) {
      throw new Error("未找到该结算记录");
    }
    const note = validateSettlementNote(noteValue);
    const previous = clubSnapshot(state);
    set({
      settlementRecords: state.settlementRecords.map((record) =>
        record.id === settlementId ? { ...record, note } : record,
      ),
      is_mutating: true,
      error: null,
    });
    try {
      const data = await apiRequest({
        action: "update_settlement_note",
        settlement_id: settlementId,
        note,
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  updateWorkerSettlementConfig: async (workerId, value) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const worker = state.workers.find((item) => item.id === workerId);
    if (!worker) throw new Error("未找到该打手");
    const config = {
      interval_days: normalizeSettlementIntervalDays(value.interval_days),
      reminder_hours: normalizeSettlementReminderHours(value.reminder_hours),
    };
    const settlementConfig = {
      ...worker.settlement_config,
      ...config,
    };
    const previous = clubSnapshot(state);
    set({
      workers: state.workers.map((item) =>
        item.id === workerId
          ? {
              ...item,
              settlement_config: {
                ...settlementConfig,
              },
            }
          : item,
      ),
      is_mutating: true,
      error: null,
    });
    try {
      const data = await apiRequest({
        action: "update_worker_settlement_config",
        worker_id: workerId,
        config,
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },
}));
