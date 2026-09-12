"use client";

import { create } from "zustand";
import type {
  ClubData,
  Order,
  OrderPricingSnapshot,
  PriceMenuItem,
  SettlementResult,
  SpecialRequirement,
  TipsByWorker,
  Worker,
  WorkerTier,
} from "@/lib/club-types";
import {
  buildPayoutWeights,
  calculateOrderBasePrice,
  calculateSettlement,
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

interface ApiData extends ClubData {
  created_order_id?: string;
  created_worker?: Worker;
  created_menu_item?: PriceMenuItem;
  new_order_id?: string;
  new_worker_id?: string;
  settlement?: SettlementResult;
}

interface ReassignmentResult {
  orderId: string;
  newWorkerId: string;
  newWorkerName: string;
}

interface ClubStore extends ClubData {
  is_loading: boolean;
  is_ready: boolean;
  is_mutating: boolean;
  error: string | null;
  last_synced_at: string | null;
  load: () => Promise<void>;
  addWorker: (data: { name: string; tier: WorkerTier }) => Promise<Worker>;
  addMenuItem: (data: Omit<PriceMenuItem, "id">) => Promise<PriceMenuItem>;
  updateWorker: (id: string, data: { name: string; tier: WorkerTier }) => Promise<void>;
  deleteWorker: (id: string) => Promise<void>;
  deleteHistoricalOrder: (orderId: string) => Promise<void>;
  cancelAndReassign: (orderId: string, oldWorkerId: string) => Promise<ReassignmentResult>;
  updateMenuItem: (item: PriceMenuItem) => Promise<void>;
  deleteMenuItem: (menuItemId: string) => Promise<void>;
  createOrder: (
    menuItemId: string,
    workerIds: string[],
    specialRequirements?: SpecialRequirement[],
    hours?: number,
  ) => Promise<string>;
  finishOrder: (orderId: string, tipsByWorker: TipsByWorker) => Promise<SettlementResult>;
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

function findReplacementWorker(
  data: ClubData,
  order: Order,
  oldWorkerId: string,
) {
  const oldWeight = order.pricing_snapshot.payout_weights.find(
    (entry) => entry.workerId === oldWorkerId,
  );
  if (!oldWeight) throw new Error("该打手不属于当前订单");

  const menuItem = data.menu.find((item) => item.id === order.menu_item_id);
  const eligibleTiers = order.pricing_snapshot.split_type === "tiered"
    ? [oldWeight.tier]
    : menuItem?.eligible_tiers ?? [oldWeight.tier];

  return data.workers.find((worker) => {
    if (
      worker.status !== "idle" ||
      order.assigned_worker_ids.includes(worker.id) ||
      !eligibleTiers.includes(worker.tier)
    ) {
      return false;
    }
    const replacementSnapshot: OrderPricingSnapshot = {
      ...order.pricing_snapshot,
      payout_weights: order.pricing_snapshot.payout_weights.map((entry) =>
        entry.workerId === oldWorkerId
          ? { ...entry, workerId: worker.id, workerName: worker.name, tier: worker.tier }
          : entry,
      ),
    };
    try {
      calculateSettlement(replacementSnapshot, {}, order.order_original_total);
      return true;
    } catch {
      return false;
    }
  });
}

function decrementCompletionCounts(workers: Worker[], removedOrders: Order[]) {
  const decrements = new Map<string, number>();
  removedOrders
    .filter((order) => order.status === "completed")
    .forEach((order) => {
      new Set(order.final_worker_incomes.map((income) => income.workerId)).forEach((workerId) => {
        decrements.set(workerId, (decrements.get(workerId) ?? 0) + 1);
      });
    });

  return workers.map((worker) => ({
    ...worker,
    total_completed_orders: Math.max(
      0,
      worker.total_completed_orders - (decrements.get(worker.id) ?? 0),
    ),
  }));
}

export const useClubStore = create<ClubStore>((set, get) => ({
  workers: [],
  menu: [],
  orders: [],
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
        orders: data.orders,
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
    if (!["1档", "2档", "3档"].includes(data.tier)) {
      throw new Error("请选择有效档位");
    }
    if (
      state.workers.some(
        (worker) => worker.name.trim().toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"),
      )
    ) {
      throw new Error("已存在同名打手，请使用其他姓名");
    }

    const worker: Worker = {
      id: crypto.randomUUID(),
      name,
      tier: data.tier,
      status: "idle",
      total_completed_orders: 0,
    };
    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
    set({
      workers: [...state.workers, worker],
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "add_worker", worker });
      const createdWorker =
        result.created_worker ??
        result.workers.find((candidate) => candidate.id === worker.id) ??
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

    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
    set({
      menu: [...state.menu, item],
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({ action: "add_menu_item", item });
      const createdMenuItem =
        result.created_menu_item ??
        result.menu.find((candidate) => candidate.id === item.id) ??
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

  updateWorker: async (id, data) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const worker = state.workers.find((candidate) => candidate.id === id);
    if (!worker) throw new Error("未找到该打手");
    const name = data.name.trim();
    if (!name) throw new Error("请输入打手姓名");
    if (worker.status === "busy" && data.tier !== worker.tier) {
      throw new Error("该打手正在接单，只能修改姓名");
    }

    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
    set({
      workers: state.workers.map((candidate) =>
        candidate.id === id ? { ...candidate, name, tier: data.tier } : candidate,
      ),
      is_mutating: true,
      error: null,
    });
    try {
      const result = await apiRequest({
        action: "update_worker",
        worker_id: id,
        data: { name, tier: data.tier },
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

    const removedOrders = state.orders.filter((order) =>
      order.assigned_worker_ids.includes(id),
    );
    // final_worker_incomes 已包含每名打手的基础工资与个人打赏；删除关联订单后，
    // 看板、排行榜、总支出及俱乐部收入都会从剩余订单实时重新派生。
    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
    set({
      workers: decrementCompletionCounts(
        state.workers.filter((candidate) => candidate.id !== id),
        removedOrders,
      ),
      orders: state.orders.filter((order) => !order.assigned_worker_ids.includes(id)),
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

    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
    // 删除整条历史订单即同时移除 final_worker_incomes（含个人打赏）与
    // final_club_income；所有财务汇总都基于剩余订单自动回退。
    set({
      workers: decrementCompletionCounts(state.workers, [order]),
      orders: state.orders.filter((candidate) => candidate.id !== orderId),
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

  cancelAndReassign: async (orderId, oldWorkerId) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order || order.status !== "active") throw new Error("订单已结束或不存在");
    const oldWorker = state.workers.find((worker) => worker.id === oldWorkerId);
    if (!oldWorker || oldWorker.status !== "busy") throw new Error("原打手当前不在接单");
    if (!order.assigned_worker_ids.includes(oldWorkerId)) {
      throw new Error("该打手不属于当前订单");
    }

    const replacement = findReplacementWorker(state, order, oldWorkerId);
    if (!replacement) throw new Error("当前无空闲打手可替换，请稍后再试");

    const optimisticId = `reassigned-${Date.now()}`;
    const assignedWorkerIds = order.assigned_worker_ids.map((workerId) =>
      workerId === oldWorkerId ? replacement.id : workerId,
    );
    const optimisticOrder: Order = {
      ...order,
      id: optimisticId,
      assigned_worker_ids: assignedWorkerIds,
      created_at: new Date().toISOString(),
      pricing_snapshot: {
        ...order.pricing_snapshot,
        payout_weights: order.pricing_snapshot.payout_weights.map((entry) =>
          entry.workerId === oldWorkerId
            ? {
                ...entry,
                workerId: replacement.id,
                workerName: replacement.name,
                tier: replacement.tier,
              }
            : entry,
        ),
      },
    };
    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
    set({
      workers: state.workers.map((worker) => {
        if (worker.id === oldWorkerId) return { ...worker, status: "idle" };
        if (worker.id === replacement.id) return { ...worker, status: "busy" };
        return worker;
      }),
      orders: [optimisticOrder, ...state.orders.filter((candidate) => candidate.id !== orderId)],
      is_mutating: true,
      error: null,
    });

    try {
      const result = await apiRequest({
        action: "cancel_and_reassign",
        order_id: orderId,
        old_worker_id: oldWorkerId,
      });
      const newWorkerId = result.new_worker_id ?? replacement.id;
      const newWorkerName =
        result.workers.find((worker) => worker.id === newWorkerId)?.name ?? replacement.name;
      set({ ...result, is_mutating: false, last_synced_at: new Date().toISOString() });
      return {
        orderId: result.new_order_id ?? optimisticId,
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
    const previous = { workers: get().workers, menu: get().menu, orders: get().orders };
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

    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
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

  createOrder: async (menuItemId, workerIds, specialRequirements = [], hours) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const menuItem = state.menu.find((item) => item.id === menuItemId);
    if (!menuItem) throw new Error("服务项目不存在");
    const selectedWorkers = getSelectedWorkers(state.workers, workerIds);
    if (selectedWorkers.some((worker) => worker.status !== "idle")) {
      throw new Error("所选打手已被占用");
    }
    if (selectedWorkers.some((worker) => !menuItem.eligible_tiers.includes(worker.tier))) {
      throw new Error("所选打手档位不符合该服务规则");
    }
    const payoutWeights = buildPayoutWeights(
      menuItem.split_type,
      selectedWorkers,
      menuItem.tiered_ratios,
    );
    const normalizedRequirements = normalizeSpecialRequirements(specialRequirements);
    const specialTotal = specialRequirementsTotal(normalizedRequirements);
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
    const orderOriginalTotal = fromCents(
      toCents(basePriceSnapshot) + toCents(specialTotal),
    );
    toCents(orderOriginalTotal);
    const snapshot: OrderPricingSnapshot = {
      service_name: menuItem.service_name,
      order_type: orderType,
      hourly_rate: hourlyRateSnapshot ?? 0,
      base_price: basePriceSnapshot,
      commission_mode: menuItem.commission_mode,
      club_commission_rate: menuItem.club_commission_rate,
      tier_commission_rates: { ...menuItem.tier_commission_rates },
      split_type: menuItem.split_type,
      tiered_ratios: menuItem.tiered_ratios,
      payout_weights: payoutWeights,
    };
    calculateSettlement(snapshot, {}, orderOriginalTotal);
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticOrder: Order = {
      id: optimisticId,
      menu_item_id: menuItemId,
      assigned_worker_ids: workerIds,
      order_type: orderType,
      hours: orderHours,
      hourly_rate_snapshot: hourlyRateSnapshot,
      split_type: menuItem.split_type,
      status: "active",
      tip: 0,
      tips_by_worker: {},
      final_club_income: null,
      final_worker_incomes: [],
      special_requirements: normalizedRequirements,
      base_price_snapshot: basePriceSnapshot,
      special_total: specialTotal,
      total_price: orderOriginalTotal,
      order_original_total: orderOriginalTotal,
      created_at: new Date().toISOString(),
      completed_at: null,
      pricing_snapshot: snapshot,
    };
    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
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
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
      return data.created_order_id ?? optimisticId;
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
     * 4. 每名打手最终收入 = 自己的基础实得 + tips_by_worker[workerId]；
     *    个人打赏 100% 归本人，不参与抽成，也不再由双人订单自动平分。
     * 5. 168 元、1档 25%、2档 20% 的 equal 单：两人各分 84 元，
     *    基础实得分别为 63 元、67.2 元，俱乐部实得 37.8 元；若仅给
     *    1档打手打赏 10 元，最终实得为 73 元、67.2 元，俱乐部仍为 37.8 元。
     */
    const normalizedTipsByWorker = normalizeTipsByWorker(
      order.pricing_snapshot,
      tipsByWorker,
    );
    const totalTip = tipsByWorkerTotal(normalizedTipsByWorker);
    const settlement = calculateSettlement(
      order.pricing_snapshot,
      normalizedTipsByWorker,
      order.order_original_total,
    );

    const completedAt = new Date().toISOString();
    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
    set({
      orders: state.orders.map((candidate) =>
        candidate.id === orderId
          ? {
              ...candidate,
              status: "completed",
              tip: totalTip,
              tips_by_worker: normalizedTipsByWorker,
              final_club_income: settlement.club_income,
              final_worker_incomes: settlement.worker_incomes,
              completed_at: completedAt,
            }
          : candidate,
      ),
      workers: state.workers.map((worker) =>
        order.assigned_worker_ids.includes(worker.id)
          ? {
              ...worker,
              status: "idle",
              total_completed_orders: worker.total_completed_orders + 1,
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
}));
