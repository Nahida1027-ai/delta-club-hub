"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Eye,
  Save,
  Trash2,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  Order,
  SettlementOrderSnapshot,
  SettlementPeriod,
  SettlementRecord,
  Worker,
} from "@/lib/club-types";
import {
  calculateWorkerEarningForOrder,
  formatSettlementDateTime,
  formatSettlementDuration,
  getOrdersForSettlementPeriod,
  getSettlementOverdueHours,
  isSettlementOverdue,
} from "@/lib/payroll-settlement";
import { fromCents, toCents } from "@/lib/settlement";
import { workerTipEarningForOrder } from "@/lib/order-earnings";
import { useClubStore } from "@/store/use-club-store";
import { TimeRangeSelector } from "@/components/filters/TimeRangeSelector";
import {
  ALL_TIME_RANGE,
  matchesTimeRange,
  timeRangeLabel,
  type TimeRangeFilter,
} from "@/lib/time-range";

const glassCard =
  "rounded-[22px] border border-white/[0.08] bg-[#1c1c1e]/75 shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur-md";
const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(value);
}

function totalWorkerAmount(orders: Order[], workerId: string) {
  return fromCents(
    orders.reduce(
      (sum, order) => sum + toCents(calculateWorkerEarningForOrder(order, workerId)),
      0,
    ),
  );
}

function totalWorkerTips(orders: Order[], workerId: string) {
  return fromCents(
    orders.reduce(
      (sum, order) => sum + toCents(workerTipEarningForOrder(order, workerId)),
      0,
    ),
  );
}

function toShanghaiDateTimeInput(timestamp: number) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function fromShanghaiDateTimeInput(value: string) {
  return Date.parse(`${value}:00+08:00`);
}

function WorkerTypeBadge({ type }: { type: Worker["workerType"] }) {
  const entertainment = type === "entertainment";
  return (
    <span
      className={`rounded-md px-2 py-1 text-[11px] ${
        entertainment
          ? "bg-[#BF5AF2]/14 text-[#D9A0FF]"
          : "bg-[#007AFF]/10 text-[#8EC9FF]"
      }`}
    >
      {entertainment ? "娱乐陪玩" : "普通打手"}
    </span>
  );
}

function resolveRecordDetails(
  record: SettlementRecord,
  orders: Order[],
): SettlementOrderSnapshot[] {
  if (record.order_details.length) {
    return record.order_details.map((detail) => {
      if (detail.tip_amount !== undefined) return detail;
      const order = orders.find((candidate) => candidate.id === detail.order_id);
      return {
        ...detail,
        tip_amount: order ? workerTipEarningForOrder(order, record.worker_id) : 0,
      };
    });
  }
  return record.order_ids.flatMap((orderId) => {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order?.completed_at) return [];
    return [{
      order_id: order.id,
      service_name: order.pricing_snapshot.service_name,
      completed_at: order.completed_at,
      worker_amount: calculateWorkerEarningForOrder(order, record.worker_id),
      tip_amount: workerTipEarningForOrder(order, record.worker_id),
    }];
  });
}

function ActivePeriodCard({
  worker,
  period,
  orders,
  now,
  onSettle,
  onDelete,
}: {
  worker: Worker;
  period: SettlementPeriod | null;
  orders: Order[];
  now: number;
  onSettle: (worker: Worker, period: SettlementPeriod) => void;
  onDelete: (worker: Worker, period: SettlementPeriod) => void;
}) {
  const isMutating = useClubStore((state) => state.is_mutating);
  const periodOrders = useMemo(
    () => period ? getOrdersForSettlementPeriod(orders, worker.id, period, now) : [],
    [now, orders, period, worker.id],
  );
  const amount = useMemo(
    () => totalWorkerAmount(periodOrders, worker.id),
    [periodOrders, worker.id],
  );
  const tipAmount = useMemo(
    () => totalWorkerTips(periodOrders, worker.id),
    [periodOrders, worker.id],
  );

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 28 }}
      className={`${glassCard} flex min-h-64 flex-col p-5`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-white">{worker.name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <WorkerTypeBadge type={worker.workerType} />
            <Badge className="border-[#30D158]/20 bg-[#30D158]/10 text-[#5FE778]">
              {period ? "周期进行中" : "尚未开启"}
            </Badge>
          </div>
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#007AFF]/12 text-[#64D2FF]">
          <CalendarClock className="size-5" />
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {period ? (
        <motion.div
          key={period.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex flex-1 flex-col"
        >
          <div className="mt-5 space-y-2 text-sm">
            <p className="flex items-center justify-between gap-3 text-white/42">
              <span>周期开始</span>
              <span className="text-right text-white/72">{formatSettlementDateTime(period.started_at)}</span>
            </p>
            <p className="flex items-center justify-between gap-3 text-white/42">
              <span>已持续</span>
              <span className="text-right text-white/72">{formatSettlementDuration(period.started_at, now)}</span>
            </p>
            <p className="flex items-center justify-between gap-3 text-white/42">
              <span>建议节奏</span>
              <span className="text-right text-white/72">每 {worker.settlement_config.interval_days} 天</span>
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/[0.04] p-3">
              <p className="text-[12px] text-white/35">已完成订单</p>
              <p className="mt-1 text-xl font-semibold text-white">{periodOrders.length} 单</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-3">
              <p className="text-[12px] text-white/35">待结工资</p>
              <p className="mt-1 text-xl font-semibold text-white">{formatMoney(amount)}</p>
            </div>
          </div>
          {tipAmount > 0 ? (
            <p className="mt-2 text-[12px] text-white/35">
              周期内打赏（已即时结算）：<span className="text-[#FFB65C]">{formatMoney(tipAmount)}</span>
            </p>
          ) : null}
          <p className="mt-auto pt-4 text-[12px] leading-5 text-white/32">删除周期后，该打手需接单后重新生成周期。</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={isMutating}
              onClick={() => onDelete(worker, period)}
              className="h-11 rounded-xl border-[#FF3B30]/25 bg-[#FF3B30]/10 text-[#FF6961] hover:bg-[#FF3B30]/20 hover:text-white"
            >
              <Trash2 className="size-4" />删除周期
            </Button>
            <Button
              disabled={isMutating}
              onClick={() => onSettle(worker, period)}
              className="h-11 rounded-xl bg-[#007AFF] text-white shadow-[0_10px_28px_rgba(0,122,255,.22)] hover:bg-[#1685ff]"
            >
              <Banknote className="size-4" />立即结算
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="empty-period"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="mt-5 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center"
        >
          <Clock3 className="mb-3 size-7 text-white/20" />
          <p className="text-sm leading-6 text-white/40">
            暂无进行中的结算周期<br />接单后自动创建
          </p>
          <Button disabled className="mt-4 h-10 rounded-xl bg-white/[0.05] text-white/25">立即结算</Button>
        </motion.div>
      )}
      </AnimatePresence>
    </motion.article>
  );
}

function SettlementConfirmDialog({
  target,
  orders,
  now,
  open,
  onOpenChange,
}: {
  target: { worker: Worker; period: SettlementPeriod } | null;
  orders: Order[];
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settleWorkerPeriod = useClubStore((state) => state.settleWorkerPeriod);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [endedAtInput, setEndedAtInput] = useState(() =>
    toShanghaiDateTimeInput(Date.now()),
  );
  const endedAt = fromShanghaiDateTimeInput(endedAtInput);
  const periodOrders = useMemo(
    () => target && Number.isFinite(endedAt)
      ? getOrdersForSettlementPeriod(orders, target.worker.id, target.period, endedAt)
      : [],
    [endedAt, orders, target],
  );
  const amount = target ? totalWorkerAmount(periodOrders, target.worker.id) : 0;
  const tipAmount = target ? totalWorkerTips(periodOrders, target.worker.id) : 0;
  const validationMessage = !target
    ? ""
    : !Number.isFinite(endedAt)
      ? "请选择有效的结算结束时间"
      : endedAt < target.period.started_at
        ? "结算结束时间不能早于周期开始时间"
        : endedAt > now
          ? "结算结束时间不能晚于当前时间"
          : "";

  if (!target) return null;

  async function confirm() {
    if (validationMessage) return;
    try {
      const record = await settleWorkerPeriod(target!.worker.id, endedAt);
      toast.success(`已生成 ${record.worker_name_snapshot} 的待发放结算`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "结算失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isMutating && onOpenChange(next)}>
      <DialogContent className="overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl sm:max-w-lg">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 27 }}
          className="grid gap-5 p-5 sm:p-6"
        >
          <DialogHeader>
            <DialogTitle className="text-xl">确认工资结算</DialogTitle>
            <DialogDescription className="text-white/45">
              {target.worker.name} · 周期开始于 {formatSettlementDateTime(target.period.started_at)}
            </DialogDescription>
          </DialogHeader>

          <label className="space-y-2">
            <span className="text-sm font-medium text-white/65">结算结束时间</span>
            <Input
              type="datetime-local"
              value={endedAtInput}
              min={toShanghaiDateTimeInput(target.period.started_at)}
              max={toShanghaiDateTimeInput(now)}
              onChange={(event) => setEndedAtInput(event.target.value)}
              className={inputClass}
            />
            {validationMessage ? <p className="text-[12px] text-[#FF6961]">{validationMessage}</p> : null}
          </label>

          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-[#007AFF]/18 bg-[#007AFF]/[0.07] p-4">
            <div>
              <p className="text-[12px] text-white/38">本次包含</p>
              <p className="mt-1 text-2xl font-semibold text-white">{periodOrders.length} 单</p>
            </div>
            <div className="text-right">
              <p className="text-[12px] text-white/38">应发工资</p>
              <p className="mt-1 text-2xl font-semibold text-[#64D2FF]">{formatMoney(amount)}</p>
            </div>
          </div>
          <p className="text-[12px] leading-5 text-white/35">
            本次结算不包含打赏，打赏已即时结算给打手。周期内即时打赏共 {formatMoney(tipAmount)}。
            确认后会关闭当前周期并立即开启新周期，经营报表不会改变。
          </p>

          <DialogFooter>
            <Button variant="ghost" disabled={isMutating} onClick={() => onOpenChange(false)} className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white">取消</Button>
            <Button disabled={Boolean(validationMessage) || isMutating} onClick={() => void confirm()} className="h-11 rounded-xl bg-[#007AFF] text-white hover:bg-[#1685ff]">
              <Banknote className="size-4" />{isMutating ? "正在结算…" : "确认结算"}
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

function SettlementDetailDialog({
  record,
  orders,
  open,
  onOpenChange,
}: {
  record: SettlementRecord | null;
  orders: Order[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!record) return null;
  const details = resolveRecordDetails(record, orders);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl sm:max-w-2xl">
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 27 }} className="flex max-h-[86vh] flex-col">
          <DialogHeader className="border-b border-white/[0.07] p-6">
            <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-[#007AFF]/15 text-[#64D2FF]"><ClipboardList className="size-5" /></span>
            <DialogTitle className="text-xl">工资结算明细</DialogTitle>
            <DialogDescription className="text-white/45">
              {record.worker_name_snapshot} · {formatSettlementDateTime(record.period_start)} 至 {formatSettlementDateTime(record.period_end)}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {details.length ? (
              <div className="space-y-2">
                {details.map((detail) => (
                  <div key={detail.order_id} className="grid gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white/85">{detail.service_name}</p>
                      <p className="mt-1 text-[12px] text-white/35">#{detail.order_id.slice(0, 12)} · 完成于 {new Date(detail.completed_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>
                    </div>
                    <p className="text-base font-semibold text-[#5FE778]">{formatMoney(detail.worker_amount)}</p>
                    {(detail.tip_amount ?? 0) > 0 ? (
                      <p className="text-[11px] text-white/30 sm:col-span-2 sm:text-right">
                        另有即时打赏 {formatMoney(detail.tip_amount ?? 0)}，不计入本次工资
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid min-h-44 place-content-center text-center"><ClipboardList className="mx-auto mb-3 size-8 text-white/20" /><p className="text-sm text-white/38">本周期没有完成订单</p></div>
            )}
          </div>
          <DialogFooter className="border-t border-white/[0.07] p-5 sm:px-6">
            <div className="mr-auto text-sm text-white/45">共 {record.total_orders} 单 · 合计 <span className="ml-2 font-semibold text-white">{formatMoney(record.total_amount)}</span></div>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white">关闭</Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

function SettlementCard({
  record,
  orders,
  overdue,
  now,
  onView,
  onDelete,
}: {
  record: SettlementRecord;
  orders: Order[];
  overdue: boolean;
  now: number;
  onView: (record: SettlementRecord) => void;
  onDelete: (record: SettlementRecord) => void;
}) {
  const markSettlementPaid = useClubStore((state) => state.markSettlementPaid);
  const updateSettlementNote = useClubStore((state) => state.updateSettlementNote);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [note, setNote] = useState(record.note);
  const isPending = record.status === "pending";
  const noteChanged = note.trim() !== record.note;
  const tipAmount = resolveRecordDetails(record, orders).reduce(
    (sum, detail) => sum + (detail.tip_amount ?? 0),
    0,
  );

  async function saveNote() {
    try {
      await updateSettlementNote(record.id, note);
      setNote(note.trim());
      toast.success("结算备注已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "备注保存失败");
    }
  }

  async function markPaid() {
    try {
      await markSettlementPaid(record.id, note);
      toast.success(`${record.worker_name_snapshot} 的工资已标记发放`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发放状态更新失败");
    }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: -16 }}
      animate={overdue ? { opacity: 1, y: 0, scale: [1, 1.006, 1] } : { opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -28 }}
      transition={overdue ? { opacity: { duration: 0.2 }, y: { type: "spring", stiffness: 280, damping: 28 }, scale: { duration: 2.2, repeat: Infinity } } : { type: "spring", stiffness: 280, damping: 28 }}
      className={`${glassCard} overflow-hidden p-5 sm:p-6 ${overdue ? "border-[#FF5E3A]/55 shadow-[0_20px_60px_rgba(255,59,48,.18)]" : ""}`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="truncate text-lg font-semibold text-white">{record.worker_name_snapshot}</h3>
            <WorkerTypeBadge type={record.worker_type_snapshot} />
            <Badge className={isPending ? "border-[#FF9F0A]/20 bg-[#FF9F0A]/12 text-[#FFB340]" : "border-[#30D158]/20 bg-[#30D158]/12 text-[#5FE778]"}>{isPending ? "待发放" : "已发放"}</Badge>
            {overdue ? (
              <Badge className="border-[#FF3B30]/30 bg-[#FF3B30]/15 text-[#FF8A84]">
                <AlertTriangle className="mr-1 size-3.5" />超期未发放 {getSettlementOverdueHours(record, now)} 小时
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 flex items-center gap-2 text-sm text-white/42"><CalendarClock className="size-4 shrink-0" />{formatSettlementDateTime(record.period_start)} ~ {formatSettlementDateTime(record.period_end)}</p>
          {record.paid_at ? <p className="mt-1 text-[12px] text-white/30">发放于 {formatSettlementDateTime(record.paid_at)}</p> : null}
        </div>
        <div className="shrink-0 lg:text-right">
          <p className="text-[12px] uppercase tracking-[0.16em] text-white/30">应发工资</p>
          <p className="mt-1 text-3xl font-semibold tracking-[-0.035em] text-white">{formatMoney(record.total_amount)}</p>
          <p className="mt-1 text-sm text-white/38">包含 {record.total_orders} 单</p>
          {tipAmount > 0 ? (
            <p className="mt-1 text-[12px] text-white/30">另有打赏 {formatMoney(tipAmount)} 已即时结算</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3.5">
        <div className="mb-2 flex items-center justify-between gap-3"><label htmlFor={`settlement-note-${record.id}`} className="text-sm font-medium text-white/58">备注</label><span className="text-[11px] text-white/25">{Array.from(note).length}/500</span></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={`settlement-note-${record.id}`} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="可填写转账渠道、凭证或说明" className={`${inputClass} flex-1`} />
          <AnimatePresence initial={false}>
            {noteChanged ? <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}><Button variant="outline" disabled={isMutating} onClick={() => void saveNote()} className="h-11 w-full rounded-xl border-white/10 bg-white/[0.05] text-white/70 hover:bg-white/[0.09] hover:text-white sm:w-auto"><Save className="size-4" />保存备注</Button></motion.div> : null}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={isMutating} onClick={() => onDelete(record)} className="h-11 rounded-xl border-[#FF3B30]/25 bg-[#FF3B30]/10 text-[#FF6961] hover:bg-[#FF3B30]/20 hover:text-white"><Trash2 className="size-4" />删除记录</Button>
        <Button variant="outline" onClick={() => onView(record)} className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white"><Eye className="size-4" />查看订单明细</Button>
        {isPending ? <Button disabled={isMutating} onClick={() => void markPaid()} className="h-11 rounded-xl bg-[#007AFF] text-white shadow-[0_10px_28px_rgba(0,122,255,.25)] hover:bg-[#1685ff]"><CheckCircle2 className="size-4" />{isMutating ? "正在处理…" : "标记已发放"}</Button> : null}
      </div>
    </motion.article>
  );
}

export function PayrollSettlementPanel() {
  const workers = useClubStore((state) => state.workers);
  const orders = useClubStore((state) => state.orders);
  const periods = useClubStore((state) => state.settlementPeriods);
  const records = useClubStore((state) => state.settlementRecords);
  const deleteSettlementRecord = useClubStore((state) => state.deleteSettlementRecord);
  const deleteSettlementPeriod = useClubStore((state) => state.deleteSettlementPeriod);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState("all");
  const [workerFilter, setWorkerFilter] = useState("all");
  const [timeRange, setTimeRange] = useState<TimeRangeFilter>(() => ({ ...ALL_TIME_RANGE }));
  const [viewing, setViewing] = useState<SettlementRecord | null>(null);
  const [settling, setSettling] = useState<{ worker: Worker; period: SettlementPeriod } | null>(null);
  const [deleting, setDeleting] = useState<SettlementRecord | null>(null);
  const [deletingPeriod, setDeletingPeriod] = useState<{
    worker: Worker;
    period: SettlementPeriod;
  } | null>(null);
  const overdueAnchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const workersById = useMemo(
    () => new Map(workers.map((worker) => [worker.id, worker])),
    [workers],
  );
  const activePeriodsById = useMemo(
    () => new Map(periods.filter((period) => period.status === "active").map((period) => [period.id, period])),
    [periods],
  );
  const filteredRecords = useMemo(
    () => records
      .filter((record) => workerFilter === "all" || record.worker_id === workerFilter)
      .filter((record) => matchesTimeRange(record.period_end, timeRange))
      .sort((first, second) => second.period_end - first.period_end),
    [records, timeRange, workerFilter],
  );
  const overdueIds = useMemo(
    () => new Set(
      filteredRecords
        .filter((record) => isSettlementOverdue(record, workersById.get(record.worker_id)?.settlement_config.reminder_hours ?? 72, now))
        .map((record) => record.id),
    ),
    [filteredRecords, now, workersById],
  );
  const pending = useMemo(
    () => filteredRecords.filter((record) => record.status === "pending"),
    [filteredRecords],
  );
  const historyWorkers = useMemo(() => {
    const byId = new Map<string, string>();
    workers.forEach((worker) => byId.set(worker.id, worker.name));
    records.forEach((record) => {
      if (!byId.has(record.worker_id)) byId.set(record.worker_id, record.worker_name_snapshot);
    });
    return [...byId.entries()];
  }, [records, workers]);
  const paid = useMemo(
    () => filteredRecords.filter((record) => record.status === "paid"),
    [filteredRecords],
  );
  const visibleRecords = tab === "pending" ? pending : tab === "history" ? paid : filteredRecords;
  const pendingTotal = pending.reduce((sum, record) => sum + record.total_amount, 0);
  const paidTotal = paid.reduce((sum, record) => sum + record.total_amount, 0);

  function showOverdue() {
    setTab("pending");
    window.requestAnimationFrame(() => overdueAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      const workerName = deleting.worker_name_snapshot;
      await deleteSettlementRecord(deleting.id);
      toast.success(`${workerName} 的结算记录已删除，关联订单已回到待结周期`);
      setDeleting(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "结算记录删除失败");
    }
  }

  async function confirmDeletePeriod() {
    if (!deletingPeriod) return;
    try {
      const workerName = deletingPeriod.worker.name;
      await deleteSettlementPeriod(deletingPeriod.period.id);
      toast.success(`${workerName} 的当前结算周期已删除`);
      setDeletingPeriod(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "结算周期删除失败");
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.18em] text-[#64D2FF]">PAYROLL</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">工资结算</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/42">接单时自动开启工资周期，由管理员选择结束时间并手动结算；订单与经营账务保持不变。</p>
        </div>
          <Badge className="h-9 border-[#FF9F0A]/20 bg-[#FF9F0A]/12 px-3 text-[#FFB340]">{pending.length ? `有 ${pending.length} 笔工资待发放` : "暂无待发放工资"}</Badge>
      </div>

      <AnimatePresence>
        {overdueIds.size ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onClick={showOverdue}
            className="flex w-full items-center justify-between gap-4 rounded-2xl border border-[#FF3B30]/35 bg-[#FF3B30]/12 px-4 py-3 text-left text-[#FF9A94] shadow-[0_16px_40px_rgba(255,59,48,.12)] backdrop-blur-xl transition hover:bg-[#FF3B30]/17"
          >
            <span className="flex items-center gap-3 text-sm font-medium"><AlertTriangle className="size-5 shrink-0" />有 {overdueIds.size} 笔工资结算超过打手设置的提醒时限，请及时处理。</span>
            <span className="shrink-0 text-[12px] text-white/50">查看待发放</span>
          </motion.button>
        ) : null}
      </AnimatePresence>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h3 className="text-lg font-semibold text-white">当前活跃周期</h3><p className="mt-1 text-sm text-white/38">首次接单自动开启，结算后立即进入下一周期。</p></div>
          <Badge className="border-[#30D158]/20 bg-[#30D158]/10 text-[#5FE778]">{periods.filter((period) => period.status === "active").length} 个进行中</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workers.map((worker) => (
            <ActivePeriodCard
              key={worker.id}
              worker={worker}
              period={worker.active_period_id ? activePeriodsById.get(worker.active_period_id) ?? null : null}
              orders={orders}
              now={now}
              onSettle={(targetWorker, period) => setSettling({ worker: targetWorker, period })}
              onDelete={(targetWorker, period) => setDeletingPeriod({ worker: targetWorker, period })}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className={`${glassCard} p-4`}><p className="text-xs text-white/38">{timeRangeLabel(timeRange)}待发放总额</p><p className="mt-2 text-xl font-semibold text-[#FFB340]">{formatMoney(pendingTotal)}</p></div>
        <div className={`${glassCard} p-4`}><p className="text-xs text-white/38">{timeRangeLabel(timeRange)}已发放总额</p><p className="mt-2 text-xl font-semibold text-[#5FE778]">{formatMoney(paidTotal)}</p></div>
        <div className={`${glassCard} p-4`}><p className="text-xs text-white/38">超期未发放</p><p className="mt-2 text-xl font-semibold text-[#FF6961]">{overdueIds.size} 笔</p></div>
      </section>

      <div ref={overdueAnchor} className="scroll-mt-40 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-11 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-1">
            <TabsTrigger value="all" className="rounded-xl px-4 text-white/48 data-[state=active]:bg-white/[0.09] data-[state=active]:text-white">全部记录 <span className="ml-1 text-[#64D2FF]">{filteredRecords.length}</span></TabsTrigger>
            <TabsTrigger value="pending" className="rounded-xl px-4 text-white/48 data-[state=active]:bg-white/[0.09] data-[state=active]:text-white">待发放 <span className="ml-1 text-[#FFB340]">{pending.length}</span></TabsTrigger>
            <TabsTrigger value="history" className="rounded-xl px-4 text-white/48 data-[state=active]:bg-white/[0.09] data-[state=active]:text-white">历史结算</TabsTrigger>
          </TabsList>
        </Tabs>
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap gap-2">
          <Select value={workerFilter} onValueChange={setWorkerFilter}>
            <SelectTrigger className={`${inputClass} min-w-40`}><SelectValue /></SelectTrigger>
            <SelectContent className="border-white/10 bg-[#242426] text-white"><SelectItem value="all">全部打手</SelectItem>{historyWorkers.map(([workerId, workerName]) => <SelectItem key={workerId} value={workerId}>{workerName}</SelectItem>)}</SelectContent>
          </Select>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </motion.div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="space-y-3">
          <AnimatePresence initial={false} mode="popLayout">
            {visibleRecords.map((record) => <SettlementCard key={record.id} record={record} orders={orders} overdue={overdueIds.has(record.id)} now={now} onView={setViewing} onDelete={setDeleting} />)}
          </AnimatePresence>
          {!visibleRecords.length ? <div className={`${glassCard} grid min-h-64 place-content-center text-center`}><WalletCards className="mx-auto mb-3 size-9 text-white/20" /><p className="text-sm text-white/40">{tab === "pending" ? "当前没有待发放结算" : "筛选范围内没有结算记录"}</p></div> : null}
        </motion.div>
      </AnimatePresence>

      <SettlementConfirmDialog key={settling ? `${settling.worker.id}:${settling.period.id}` : "closed"} target={settling} orders={orders} now={now} open={Boolean(settling)} onOpenChange={(next) => !next && setSettling(null)} />
      <SettlementDetailDialog key={viewing?.id ?? "closed"} record={viewing} orders={orders} open={Boolean(viewing)} onOpenChange={(next) => !next && setViewing(null)} />
      <AlertDialog open={Boolean(deletingPeriod)} onOpenChange={(next) => !next && !isMutating && setDeletingPeriod(null)}>
        <AlertDialogContent className="border-white/10 bg-[#171719]/95 text-white shadow-2xl backdrop-blur-xl">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 27 }}>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-[#FF3B30]/12 text-[#FF6961]"><Trash2 className="size-5" /></AlertDialogMedia>
              <AlertDialogTitle>删除当前结算周期</AlertDialogTitle>
              <AlertDialogDescription className="leading-6 text-white/45">确定要删除该打手的结算周期吗？删除后该打手的结算界面将重置为“暂无进行中的结算周期”，历史已结算记录不受影响，周期内未结算的订单将保持未结算状态。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-5">
              <AlertDialogCancel disabled={isMutating} className="border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white">取消</AlertDialogCancel>
              <AlertDialogAction disabled={isMutating} onClick={(event) => { event.preventDefault(); void confirmDeletePeriod(); }} className="bg-[#FF3B30] text-white hover:bg-[#FF453A]">{isMutating ? "正在删除…" : "确认删除周期"}</AlertDialogAction>
            </AlertDialogFooter>
          </motion.div>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(deleting)} onOpenChange={(next) => !next && !isMutating && setDeleting(null)}>
        <AlertDialogContent className="border-white/10 bg-[#171719]/95 text-white shadow-2xl backdrop-blur-xl">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 27 }}>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-[#FF3B30]/12 text-[#FF6961]"><Trash2 className="size-5" /></AlertDialogMedia>
              <AlertDialogTitle>删除工资结算记录</AlertDialogTitle>
              <AlertDialogDescription className="leading-6 text-white/45">确定要删除该结算记录吗？删除后只有订单工资会恢复为未结算状态并重新计入下一轮；已即时发放的打赏不会回滚。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-5">
              <AlertDialogCancel disabled={isMutating} className="border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white">取消</AlertDialogCancel>
              <AlertDialogAction disabled={isMutating} onClick={(event) => { event.preventDefault(); void confirmDelete(); }} className="bg-[#FF3B30] text-white hover:bg-[#FF453A]">{isMutating ? "正在删除…" : "确认删除"}</AlertDialogAction>
            </AlertDialogFooter>
          </motion.div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
