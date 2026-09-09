"use client";

import { create } from "zustand";
import type {
  ClubData,
  Order,
  OrderPricingSnapshot,
  PriceMenuItem,
  SettlementResult,
  Worker,
} from "@/lib/club-types";
import {
  buildPayoutWeights,
  fromCents,
  toCents,
  validateMenuRule,
} from "@/lib/settlement";

interface ApiData extends ClubData {
  created_order_id?: string;
  settlement?: SettlementResult;
}

interface ClubStore extends ClubData {
  is_loading: boolean;
  is_ready: boolean;
  is_mutating: boolean;
  error: string | null;
  last_synced_at: string | null;
  load: () => Promise<void>;
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

