"use client";

import { useEffect } from "react";
import { useClubStore } from "@/store/use-club-store";

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("输入必须是对象");
  }
  return input as Record<string, unknown>;
}

export function useClubWebMcp() {
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const options = { signal: lifecycle.signal };

    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: "read_club_status",
            title: "读取俱乐部状态",
            description: "读取当前空闲/忙碌打手、进行中订单和已配置服务的简要状态，不修改数据。",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: false },
            execute() {
              const state = useClubStore.getState();
              return {
                workers: state.workers.map(({ id, name, tier, status }) => ({ id, name, tier, status })),
                activeOrders: state.orders
                  .filter((order) => order.status === "active")
                  .map((order) => ({
                    id: order.id,
                    serviceName: order.pricing_snapshot.service_name,
                    workerIds: order.assigned_worker_ids,
                  })),
                services: state.menu.map(({ id, service_name, split_type }) => ({
                  id,
                  serviceName: service_name,
                  splitType: split_type,
                })),
              };
            },
          },
          options,
        ),
      ).catch((error) => console.error("WebMCP read_club_status registration failed", error));

      void Promise.resolve(
        context.registerTool(
          {
            name: "create_club_order",
            title: "创建俱乐部订单",
            description: "使用一个服务 ID 和符合规则的空闲打手 ID 创建订单，并立即锁定这些打手。",
            inputSchema: {
              type: "object",
              properties: {
                menuItemId: { type: "string", description: "价格表服务 ID" },
                workerIds: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  maxItems: 2,
                  uniqueItems: true,
                  description: "分配的打手 ID；人数必须匹配服务模式",
                },
              },
              required: ["menuItemId", "workerIds"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            async execute(input) {
              const data = objectInput(input);
              if (typeof data.menuItemId !== "string" || !Array.isArray(data.workerIds)) {
                throw new Error("menuItemId 和 workerIds 为必填项");
              }
              const workerIds = data.workerIds.map((value) => {
                if (typeof value !== "string") throw new Error("workerIds 只能包含字符串");
                return value;
              });
              const orderId = await useClubStore
                .getState()
                .createOrder(data.menuItemId, workerIds);
              return { orderId, status: "active", lockedWorkerIds: workerIds };
            },
          },
          options,
        ),
      ).catch((error) => console.error("WebMCP create_club_order registration failed", error));

      void Promise.resolve(
        context.registerTool(
          {
            name: "finish_club_order",
            title: "结束并结算订单",
            description: "结束一张进行中订单，记录老板打赏，自动拆分俱乐部与打手收入并释放全部打手。",
            inputSchema: {
              type: "object",
              properties: {
                orderId: { type: "string", description: "进行中订单 ID" },
                tip: { type: "number", minimum: 0, multipleOf: 0.01, description: "老板打赏金额，单位为元" },
              },
              required: ["orderId", "tip"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            async execute(input) {
              const data = objectInput(input);
              if (typeof data.orderId !== "string" || typeof data.tip !== "number") {
                throw new Error("orderId 和 tip 为必填项");
              }
              const settlement = await useClubStore
                .getState()
                .finishOrder(data.orderId, data.tip);
              return {
                orderId: data.orderId,
                status: "completed",
                clubIncome: settlement.club_income,
                workerIncomes: settlement.worker_incomes,
              };
            },
          },
          options,
        ),
      ).catch((error) => console.error("WebMCP finish_club_order registration failed", error));
    } catch (error) {
      console.error("WebMCP registration failed", error);
    }

    return () => lifecycle.abort();
  }, []);
}

