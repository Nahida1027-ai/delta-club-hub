"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRightLeft, Search, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  Order,
  OrderPricingSnapshot,
  PriceMenuItem,
  Worker,
} from "@/lib/club-types";
import {
  calculateSettlement,
  calculateSettlementWithTransferFees,
  fromCents,
  toCents,
} from "@/lib/settlement";
import { isWorkerEligibleForRule } from "@/lib/worker-eligibility";
import { aggregateTransferFees } from "@/lib/transfer-fees";
import { useClubStore } from "@/store/use-club-store";

const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(value);
}

function workerMeta(worker: Worker) {
  return worker.workerType === "entertainment"
    ? "娱乐陪玩"
    : `${worker.tier ?? "无档位"} · 普通打手`;
}

export function ReassignOrderModal({
  order,
  oldWorker,
  menuItem,
  workers,
  open,
  onOpenChange,
}: {
  order: Order | null;
  oldWorker: Worker | null;
  menuItem: PriceMenuItem | null;
  workers: Worker[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const replaceWorkerWithFee = useClubStore((state) => state.replaceWorkerWithFee);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [query, setQuery] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [transferFeeInput, setTransferFeeInput] = useState("0");

  const oldWeight = order?.pricing_snapshot.payout_weights.find(
    (entry) => entry.workerId === oldWorker?.id,
  );
  const assignmentRule = useMemo(
    () => order && menuItem && oldWeight
      ? {
          commission_mode: order.pricing_snapshot.commission_mode,
          split_type: order.pricing_snapshot.split_type,
          eligible_tiers:
            order.pricing_snapshot.split_type === "tiered" && oldWeight.tier
              ? [oldWeight.tier]
              : menuItem.eligible_tiers,
        }
      : null,
    [menuItem, oldWeight, order],
  );

  const candidates = useMemo(() => {
    if (!order || !assignmentRule) return [];
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return workers
      .filter(
        (worker) =>
          worker.status === "idle" &&
          !order.assigned_worker_ids.includes(worker.id),
      )
      .map((worker) => {
        let eligible = isWorkerEligibleForRule(assignmentRule, worker);
        if (eligible) {
          const snapshot: OrderPricingSnapshot = {
            ...order.pricing_snapshot,
            payout_weights: order.pricing_snapshot.payout_weights.map((entry) =>
              entry.workerId === oldWorker?.id
                ? {
                    ...entry,
                    workerId: worker.id,
                    workerName: worker.name,
                    workerType: worker.workerType,
                    tier: worker.tier,
                  }
                : entry,
            ),
          };
          try {
            calculateSettlement(snapshot, {}, order.order_original_total);
          } catch {
            eligible = false;
          }
        }
        return { worker, eligible };
      })
      .filter(({ worker }) => {
        if (!keyword) return true;
        return `${worker.name} ${workerMeta(worker)}`
          .toLocaleLowerCase("zh-CN")
          .includes(keyword);
      });
  }, [assignmentRule, oldWorker?.id, order, query, workers]);

  const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId) ?? null;
  let transferFee = 0;
  let feeError = "";
  let previewError = "";
  let replacementSnapshot: OrderPricingSnapshot | null = null;
  let orderShare = 0;
  let replacementTotal = 0;
  let clubIncome = 0;
  let retainedIncomes: Array<{ workerId: string; amount: number }> = [];
  try {
    if (
      transferFeeInput.trim() === "" ||
      !/^\d+(\.\d{0,2})?$/.test(transferFeeInput)
    ) {
      throw new Error("请输入非负金额，最多两位小数");
    }
    transferFee = fromCents(toCents(Number(transferFeeInput)));
  } catch (error) {
    feeError = error instanceof Error ? error.message : "转单费无效";
  }

  if (order && oldWorker && selectedWorker && !feeError) {
    try {
      if (!candidates.some(({ worker, eligible }) => worker.id === selectedWorker.id && eligible)) {
        throw new Error("所选新打手不符合本单规则");
      }
      replacementSnapshot = {
        ...order.pricing_snapshot,
        payout_weights: order.pricing_snapshot.payout_weights.map((entry) =>
          entry.workerId === oldWorker.id
            ? {
                ...entry,
                workerId: selectedWorker.id,
                workerName: selectedWorker.name,
                workerType: selectedWorker.workerType,
                tier: selectedWorker.tier,
              }
            : entry,
        ),
      };
      const basePreview = calculateSettlement(
        replacementSnapshot,
        {},
        order.order_original_total,
      );
      const transferFees = order.transfer_fees?.length
        ? aggregateTransferFees(order.transfer_fees)
        : { ...(order.transfer_fees_by_worker ?? {}) };
      transferFees[selectedWorker.id] = fromCents(
        toCents(transferFees[selectedWorker.id] ?? 0) + toCents(transferFee),
      );
      const finalPreview = calculateSettlementWithTransferFees(
        replacementSnapshot,
        {},
        order.order_original_total,
        transferFees,
      );
      orderShare = basePreview.worker_incomes.find(
        (income) => income.workerId === selectedWorker.id,
      )?.amount ?? 0;
      replacementTotal = finalPreview.worker_incomes.find(
        (income) => income.workerId === selectedWorker.id,
      )?.amount ?? 0;
      retainedIncomes = basePreview.worker_incomes.filter(
        (income) => income.workerId !== selectedWorker.id,
      );
      clubIncome = finalPreview.club_income;
    } catch (error) {
      previewError = error instanceof Error ? error.message : "无法计算换人预览";
    }
  }

  if (!order || !oldWorker) return null;
  const canSubmit = Boolean(selectedWorker && replacementSnapshot && !feeError && !previewError);

  async function confirm() {
    if (!selectedWorker || !canSubmit) return;
    try {
      await replaceWorkerWithFee(
        order!.id,
        oldWorker!.id,
        selectedWorker.id,
        transferFee,
      );
      toast.success(`${oldWorker!.name} 已换下，${selectedWorker.name} 接单，转单费 ${formatMoney(transferFee)} 进入工资周期`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "换人失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isMutating && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl sm:max-w-3xl">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 27 }}
          className="flex max-h-[90vh] flex-col"
        >
          <DialogHeader className="border-b border-white/[0.07] p-5 sm:p-6">
            <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-[#007AFF]/15 text-[#64D2FF]">
              <ArrowRightLeft className="size-5" />
            </span>
            <DialogTitle className="text-xl">手动更换打手</DialogTitle>
            <DialogDescription className="text-white/45">
              选择接替人并设置工资属性的转单费，转单费只归新打手且不影响俱乐部抽成。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
            <section className="grid gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="font-medium text-white">{order.pricing_snapshot.service_name}</p>
                <p className="mt-1 text-sm text-white/40">
                  {order.assigned_worker_ids.length > 1 ? "双人订单 · 仅替换当前打手" : "单人订单"}
                  {" · "}被换下：{oldWorker.name} · {workerMeta(oldWorker)}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-[12px] text-white/35">订单总价</p>
                <p className="mt-1 text-xl font-semibold text-[#64D2FF]">{formatMoney(order.total_price)}</p>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-white/75">选择新打手</h3>
                  <p className="mt-1 text-[12px] text-white/35">仅空闲打手可选；不符合本单规则的打手会显示为禁用。</p>
                </div>
                <Badge className="border-[#30D158]/20 bg-[#30D158]/10 text-[#5FE778]">
                  {candidates.filter((candidate) => candidate.eligible).length} 人可接
                </Badge>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/28" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、档位或类型" className={`${inputClass} pl-9`} />
              </div>
              <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {candidates.map(({ worker, eligible }) => {
                  const selected = selectedWorkerId === worker.id;
                  return (
                    <button
                      key={worker.id}
                      type="button"
                      disabled={!eligible}
                      onClick={() => setSelectedWorkerId(worker.id)}
                      className={`flex min-h-16 items-center gap-3 rounded-2xl border p-3 text-left transition ${
                        selected
                          ? "border-[#007AFF]/60 bg-[#007AFF]/15 shadow-[0_10px_24px_rgba(0,122,255,.14)]"
                          : eligible
                            ? "border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.07]"
                            : "cursor-not-allowed border-white/[0.05] bg-white/[0.02] opacity-40"
                      }`}
                    >
                      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${selected ? "bg-[#007AFF] text-white" : "bg-white/[0.06] text-white/55"}`}>
                        <UserRound className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-white">{worker.name}</span>
                        <span className="mt-0.5 block text-[12px] text-white/35">{eligible ? workerMeta(worker) : "不符合本单档位或抽成规则"}</span>
                      </span>
                    </button>
                  );
                })}
                {!candidates.length ? (
                  <div className="sm:col-span-2 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/35">
                    {query ? "没有匹配的空闲打手" : "当前没有可供选择的空闲打手"}
                  </div>
                ) : null}
              </div>
            </section>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-white/70">转单费金额（元）</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35">¥</span>
                <Input inputMode="decimal" value={transferFeeInput} onChange={(event) => setTransferFeeInput(event.target.value)} className={`${inputClass} pl-8`} aria-invalid={Boolean(feeError)} />
              </div>
              {feeError ? <p className="text-[12px] text-[#FF6961]">{feeError}</p> : null}
              <p className="text-[12px] leading-5 text-white/38">转单费由被换下打手承担，只进入新打手的工资周期；不扣减原打手账面收入，也不影响俱乐部抽成。</p>
            </label>

            <AnimatePresence mode="wait" initial={false}>
              {selectedWorker && !previewError && !feeError ? (
                <motion.section
                  key={selectedWorker.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="overflow-hidden rounded-2xl border border-[#007AFF]/18 bg-[#007AFF]/[0.07]"
                >
                  <div className="grid grid-cols-2 divide-x divide-white/[0.07] border-b border-white/[0.07] sm:grid-cols-4">
                    <div className="p-3"><p className="text-[12px] text-white/35">订单份额</p><p className="mt-1 font-semibold text-white">{formatMoney(orderShare)}</p></div>
                    <div className="p-3"><p className="text-[12px] text-white/35">转单费</p><p className="mt-1 font-semibold text-[#5FE778]">+{formatMoney(transferFee)}</p></div>
                    <div className="p-3"><p className="text-[12px] text-white/35">新打手总收入</p><p className="mt-1 font-semibold text-[#64D2FF]">{formatMoney(replacementTotal)}</p></div>
                    <div className="p-3"><p className="text-[12px] text-white/35">俱乐部实得</p><p className="mt-1 font-semibold text-white">{formatMoney(clubIncome)}</p></div>
                  </div>
                  <div className="space-y-2 p-4 text-sm">
                    <p className="flex justify-between gap-3 text-white/52"><span>被换下打手 · {oldWorker.name}</span><span className="text-[#FF8A84]">¥0.00</span></p>
                    {retainedIncomes.map((income) => {
                      const retained = workers.find((worker) => worker.id === income.workerId);
                      return <p key={income.workerId} className="flex justify-between gap-3 text-white/52"><span>保留打手 · {retained?.name ?? income.workerId}</span><span className="text-white/80">{formatMoney(income.amount)}</span></p>;
                    })}
                  </div>
                </motion.section>
              ) : null}
            </AnimatePresence>
            {previewError ? <p className="text-sm text-[#FF6961]">{previewError}</p> : null}
          </div>

          <DialogFooter className="border-t border-white/[0.07] p-5 sm:p-6">
            <Button variant="ghost" disabled={isMutating} onClick={() => onOpenChange(false)} className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white">取消</Button>
            <Button disabled={!canSubmit || isMutating} onClick={() => void confirm()} className="h-11 rounded-xl bg-[#007AFF] text-white shadow-[0_10px_28px_rgba(0,122,255,.22)] hover:bg-[#1685ff]">
              <ArrowRightLeft className="size-4" />{isMutating ? "正在换人…" : "确认换人"}
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
