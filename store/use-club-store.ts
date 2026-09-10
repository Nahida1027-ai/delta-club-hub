"use client";

import { create } from "zustand";
import type {
  ClubData,
  Order,
  OrderPricingSnapshot,
  PriceMenuItem,
  SettlementResult,
  Worker,
  WorkerTier,
} from "@/lib/club-types";
import {
  buildPayoutWeights,
  fromCents,
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
  createOrder: (menuItemId: string, workerIds: string[]) => Promise<string>;
  finishOrder: (orderId: string, tip: number) => Promise<SettlementResult>;
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

  return data.workers.find(
    (worker) =>
      worker.status === "idle" &&
      !order.assigned_worker_ids.includes(worker.id) &&
      eligibleTiers.includes(worker.tier),
  );
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
    const item: PriceMenuItem = {
      ...data,
      id: crypto.randomUUID(),
      service_name: data.service_name.trim(),
      tiered_ratios:
        data.split_type === "tiered" && data.tiered_ratios
          ? { ...data.tiered_ratios }
          : null,
      eligible_tiers:
        data.split_type === "tiered"
          ? ["1档", "2档"]
          : [...data.eligible_tiers],
    };
    if (toCents(item.base_price) <= 0) throw new Error("基础价格必须大于 0");
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
    validateMenuRule(item);
    const previous = { workers: get().workers, menu: get().menu, orders: get().orders };
    set((state) => ({
      menu: state.menu.map((current) => (current.id === item.id ? item : current)),
      is_mutating: true,
      error: null,
    }));
    try {
      const data = await apiRequest({ action: "update_menu", item });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  createOrder: async (menuItemId, workerIds) => {
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
    const snapshot: OrderPricingSnapshot = {
      service_name: menuItem.service_name,
      base_price: menuItem.base_price,
      club_commission_rate: menuItem.club_commission_rate,
      split_type: menuItem.split_type,
      tiered_ratios: menuItem.tiered_ratios,
      payout_weights: payoutWeights,
    };
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticOrder: Order = {
      id: optimisticId,
      menu_item_id: menuItemId,
      assigned_worker_ids: workerIds,
      status: "active",
      tip: 0,
      final_club_income: null,
      final_worker_incomes: [],
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
      });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
      return data.created_order_id ?? optimisticId;
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },

  finishOrder: async (orderId, tip) => {
    if (get().is_mutating) throw new Error("上一项操作仍在处理中");
    const state = get();
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order || order.status !== "active") {
      throw new Error("订单已结束或不存在，未重复结算");
    }

    /*
     * 完整财务拆分算法（全部先换算为整数分）：
     * 1. 可分配总池 = 基础单价 + 打赏。
     * 2. 俱乐部收入 = 基础单价 × 抽成比例；打赏不参与抽成。
     * 3. 打手池 = 可分配总池 - 俱乐部收入。
     * 4. single / equal / tiered 读取下单时已冻结的 payout_weights 分配。
     * 最大余数法负责分配不足 1 分的尾差，保证每一分钱守恒。
     */
    const baseCents = toCents(order.pricing_snapshot.base_price);
    const tipCents = toCents(tip);
    const commissionBps = Math.round(
      order.pricing_snapshot.club_commission_rate * 100,
    );
    const totalPoolCents = baseCents + tipCents;
    const clubIncomeCents = Math.round((baseCents * commissionBps) / 10_000);
    const workerPoolCents = totalPoolCents - clubIncomeCents;
    const weighted = order.pricing_snapshot.payout_weights.map((entry, index) => {
      const numerator = workerPoolCents * Math.round(entry.weight * 100);
      return {
        workerId: entry.workerId,
        index,
        cents: Math.floor(numerator / 10_000),
        remainder: numerator % 10_000,
      };
    });
    if (!weighted.length) throw new Error("订单没有可结算的打手");
    let remaining =
      workerPoolCents - weighted.reduce((sum, entry) => sum + entry.cents, 0);
    const remainderOrder = [...weighted].sort(
      (a, b) => b.remainder - a.remainder || a.index - b.index,
    );
    for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
      remainderOrder[index % remainderOrder.length].cents += 1;
    }
    const settlement: SettlementResult = {
      total_pool: fromCents(totalPoolCents),
      club_income: fromCents(clubIncomeCents),
      worker_pool: fromCents(workerPoolCents),
      worker_incomes: weighted.map((entry) => ({
        workerId: entry.workerId,
        amount: fromCents(entry.cents),
      })),
    };

    const completedAt = new Date().toISOString();
    const previous = { workers: state.workers, menu: state.menu, orders: state.orders };
    set({
      orders: state.orders.map((candidate) =>
        candidate.id === orderId
          ? {
              ...candidate,
              status: "completed",
              tip: fromCents(tipCents),
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
      const data = await apiRequest({ action: "finish_order", order_id: orderId, tip });
      set({ ...data, is_mutating: false, last_synced_at: new Date().toISOString() });
      return data.settlement ?? settlement;
    } catch (error) {
      set({ ...previous, is_mutating: false });
      throw error;
    }
  },
}));
