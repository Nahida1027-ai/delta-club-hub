"use client";

import { useEffect } from "react";
import type { SpecialRequirement, TipsByWorker } from "@/lib/club-types";
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
                workers: state.workers.map(({ id, name, gender, tier, workerType, order, status }) => ({ id, name, gender, tier, workerType, order, status })),
                activeOrders: state.orders
                  .filter((order) => order.status === "active")
                  .map((order) => ({
                    id: order.id,
                    serviceName: order.pricing_snapshot.service_name,
                    orderType: order.order_type,
                    hours: order.hours,
                    hourlyRate: order.hourly_rate_snapshot,
                    workerIds: order.assigned_worker_ids,
                    basePrice: order.base_price_snapshot,
                    specialTotal: order.special_total,
                    totalPrice: order.total_price,
                    specialRequirementCount: order.special_requirements.length,
                  })),
                folders: state.folders,
                services: state.menu.map(({ id, service_name, folderId, order, order_type, hourly_rate, split_type, commission_mode }) => ({
                  id,
                  serviceName: service_name,
                  folderId,
                  order,
                  orderType: order_type,
                  hourlyRate: hourly_rate,
                  splitType: split_type,
                  commissionMode: commission_mode,
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
            description: "使用服务、符合规则的空闲打手及可选特殊需求创建订单，并立即锁定这些打手。",
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
                specialRequirements: {
                  type: "array",
                  maxItems: 20,
                  description: "可选特殊需求；加价会与基础价格一起参与抽成",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", minLength: 1, maxLength: 60 },
                      price: { type: "number", minimum: 0, multipleOf: 0.01 },
                    },
                    required: ["name", "price"],
                    additionalProperties: false,
                  },
                },
                hours: {
                  type: "number",
                  minimum: 1,
                  maximum: 24,
                  multipleOf: 0.5,
                  description: "陪玩单时长；护航单忽略。未提供时陪玩单默认 1 小时",
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
              const specialRequirements: SpecialRequirement[] = Array.isArray(data.specialRequirements)
                ? data.specialRequirements.map((value) => {
                    const requirement = objectInput(value);
                    if (typeof requirement.name !== "string" || typeof requirement.price !== "number") {
                      throw new Error("specialRequirements 需要 name 和 price");
                    }
                    return { name: requirement.name, price: requirement.price };
                  })
                : [];
              const hours = data.hours === undefined ? undefined : Number(data.hours);
              if (hours !== undefined && !Number.isFinite(hours)) {
                throw new Error("hours 必须是有效数字");
              }
              const orderId = await useClubStore
                .getState()
                .createOrder(data.menuItemId, workerIds, specialRequirements, hours);
              return {
                orderId,
                status: "active",
                lockedWorkerIds: workerIds,
                hours: hours ?? null,
                specialRequirementCount: specialRequirements.length,
              };
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
            description: "结束一张进行中订单，为每名参与打手分别记录打赏，自动结算并释放全部打手。",
            inputSchema: {
              type: "object",
              properties: {
                orderId: { type: "string", description: "进行中订单 ID" },
                tipsByWorker: {
                  type: "object",
                  description: "按打手 ID 记录的独立打赏金额；未提供的参与打手按 0 元处理",
                  additionalProperties: {
                    type: "number",
                    minimum: 0,
                    multipleOf: 0.01,
                  },
                },
              },
              required: ["orderId", "tipsByWorker"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            async execute(input) {
              const data = objectInput(input);
              if (typeof data.orderId !== "string") {
                throw new Error("orderId 为必填项");
              }
              const rawTips = objectInput(data.tipsByWorker);
              const tipsByWorker = Object.fromEntries(
                Object.entries(rawTips).map(([workerId, amount]) => {
                  if (typeof amount !== "number") {
                    throw new Error("tipsByWorker 的金额必须是数字");
                  }
                  return [workerId, amount];
                }),
              ) as TipsByWorker;
              const settlement = await useClubStore
                .getState()
                .finishOrder(data.orderId, tipsByWorker);
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
