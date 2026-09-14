"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Eye,
  RefreshCw,
  Save,
  WalletCards,
} from "lucide-react";
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
  SettlementRecord,
  Worker,
} from "@/lib/club-types";
import {
  calculateWorkerEarningForOrder,
  formatSettlementDateTime,
} from "@/lib/payroll-settlement";
import { useClubStore } from "@/store/use-club-store";

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

function resolveRecordDetails(
  record: SettlementRecord,
  orders: Order[],
): SettlementOrderSnapshot[] {
  if (record.order_details.length) return record.order_details;
  return record.order_ids.flatMap((orderId) => {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order?.completed_at) return [];
    return [{
      order_id: order.id,
      service_name: order.pricing_snapshot.service_name,
      completed_at: order.completed_at,
      worker_amount: calculateWorkerEarningForOrder(order, record.worker_id),
    }];
  });
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
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 27 }}
          className="flex max-h-[86vh] flex-col"
        >
          <DialogHeader className="border-b border-white/[0.07] p-6">
            <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-[#007AFF]/15 text-[#64D2FF]">
              <ClipboardList className="size-5" />
            </span>
            <DialogTitle className="text-xl">工资结算明细</DialogTitle>
            <DialogDescription className="text-white/45">
              {record.worker_name_snapshot} · {formatSettlementDateTime(record.period_start)} 至 {formatSettlementDateTime(record.period_end)}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {details.length ? (
              <div className="space-y-2">
                {details.map((detail) => (
                  <div
                    key={detail.order_id}
                    className="grid gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white/85">
                        {detail.service_name}
                      </p>
                      <p className="mt-1 text-[12px] text-white/35">
                        #{detail.order_id.slice(0, 12)} · 完成于 {new Date(detail.completed_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}
                      </p>
                    </div>
                    <p className="text-base font-semibold text-[#5FE778]">
                      {formatMoney(detail.worker_amount)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid min-h-44 place-content-center text-center">
                <ClipboardList className="mx-auto mb-3 size-8 text-white/20" />
                <p className="text-sm text-white/38">本周期没有完成订单</p>
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-white/[0.07] p-5 sm:px-6">
            <div className="mr-auto text-sm text-white/45">
              共 {record.total_orders} 单 · 合计
              <span className="ml-2 font-semibold text-white">{formatMoney(record.total_amount)}</span>
            </div>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
            >
              关闭
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

function SettlementCard({
  record,
  onView,
}: {
  record: SettlementRecord;
  onView: (record: SettlementRecord) => void;
}) {
  const markSettlementPaid = useClubStore((state) => state.markSettlementPaid);
  const updateSettlementNote = useClubStore((state) => state.updateSettlementNote);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [note, setNote] = useState(record.note);
  const isPending = record.status === "pending";
  const noteChanged = note.trim() !== record.note;

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
      layout
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ type: "spring", stiffness: 280, damping: 28 }}
      className={`${glassCard} overflow-hidden p-5 sm:p-6`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="truncate text-lg font-semibold text-white">
              {record.worker_name_snapshot}
            </h3>
            <WorkerTypeBadge type={record.worker_type_snapshot} />
            <Badge
              className={
                isPending
                  ? "border-[#FF9F0A]/20 bg-[#FF9F0A]/12 text-[#FFB340]"
                  : "border-[#30D158]/20 bg-[#30D158]/12 text-[#5FE778]"
              }
            >
              {isPending ? "待发放" : "已发放"}
            </Badge>
          </div>
          <p className="mt-2 flex items-center gap-2 text-sm text-white/42">
            <CalendarClock className="size-4 shrink-0" />
            {formatSettlementDateTime(record.period_start)} ~ {formatSettlementDateTime(record.period_end)}
          </p>
          {record.paid_at ? (
            <p className="mt-1 text-[12px] text-white/30">
              发放于 {formatSettlementDateTime(record.paid_at)}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 lg:text-right">
          <p className="text-[12px] uppercase tracking-[0.16em] text-white/30">应发工资</p>
          <p className="mt-1 text-3xl font-semibold tracking-[-0.035em] text-white">
            {formatMoney(record.total_amount)}
          </p>
          <p className="mt-1 text-sm text-white/38">包含 {record.total_orders} 单</p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3.5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor={`settlement-note-${record.id}`} className="text-sm font-medium text-white/58">
            备注
          </label>
          <span className="text-[11px] text-white/25">{Array.from(note).length}/500</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`settlement-note-${record.id}`}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="可填写转账渠道、凭证或说明"
            className={`${inputClass} flex-1`}
          />
          <AnimatePresence initial={false}>
            {noteChanged ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <Button
                  variant="outline"
                  disabled={isMutating}
                  onClick={() => void saveNote()}
                  className="h-11 w-full rounded-xl border-white/10 bg-white/[0.05] text-white/70 hover:bg-white/[0.09] hover:text-white sm:w-auto"
                >
                  <Save className="size-4" />保存备注
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={() => onView(record)}
          className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white"
        >
          <Eye className="size-4" />查看订单明细
        </Button>
        {isPending ? (
          <Button
            disabled={isMutating}
            onClick={() => void markPaid()}
            className="h-11 rounded-xl bg-[#007AFF] text-white shadow-[0_10px_28px_rgba(0,122,255,.25)] hover:bg-[#1685ff]"
          >
            <CheckCircle2 className="size-4" />
            {isMutating ? "正在处理…" : "标记已发放"}
          </Button>
        ) : null}
      </div>
    </motion.article>
  );
}

export function PayrollSettlementPanel() {
  const workers = useClubStore((state) => state.workers);
  const orders = useClubStore((state) => state.orders);
  const records = useClubStore((state) => state.settlementRecords);
  const isMutating = useClubStore((state) => state.is_mutating);
  const isChecking = useClubStore((state) => state.is_checking_settlements);
  const generateSettlementForWorker = useClubStore(
    (state) => state.generateSettlementForWorker,
  );
  const checkAndGenerateSettlements = useClubStore(
    (state) => state.checkAndGenerateSettlements,
  );
  const [tab, setTab] = useState("pending");
  const [workerFilter, setWorkerFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [manualWorkerId, setManualWorkerId] = useState("");
  const [viewing, setViewing] = useState<SettlementRecord | null>(null);

  const selectedManualWorkerId = manualWorkerId || workers[0]?.id || "";
  const historyWorkers = useMemo(() => {
    const byId = new Map<string, string>();
    workers.forEach((worker) => byId.set(worker.id, worker.name));
    records.forEach((record) => {
      if (!byId.has(record.worker_id)) {
        byId.set(record.worker_id, record.worker_name_snapshot);
      }
    });
    return [...byId.entries()];
  }, [records, workers]);

  const pending = useMemo(
    () => records.filter((record) => record.status === "pending").sort((a, b) => a.period_end - b.period_end),
    [records],
  );
  const paid = useMemo(() => {
    const start = dateFrom ? Date.parse(`${dateFrom}T00:00:00+08:00`) : null;
    const end = dateTo ? Date.parse(`${dateTo}T23:59:59.999+08:00`) : null;
    return records
      .filter((record) => record.status === "paid")
      .filter((record) => workerFilter === "all" || record.worker_id === workerFilter)
      .filter((record) => start === null || record.period_end >= start)
      .filter((record) => end === null || record.period_end <= end)
      .sort((a, b) => b.period_end - a.period_end);
  }, [dateFrom, dateTo, records, workerFilter]);
  const visibleRecords = tab === "pending" ? pending : paid;

  async function runDueCheck() {
    try {
      const count = await checkAndGenerateSettlements();
      toast.success(count ? `已生成 ${count} 条到期结算` : "当前没有到期结算");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "结算检查失败");
    }
  }

  async function generateNow() {
    if (!selectedManualWorkerId) return;
    try {
      const record = await generateSettlementForWorker(selectedManualWorkerId);
      if (record) {
        toast.success(`已为 ${record.worker_name_snapshot} 生成结算`);
        setTab("pending");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "结算生成失败");
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.18em] text-[#64D2FF]">PAYROLL</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">工资结算</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/42">
            每名打手按独立周期归批；这里只管理线下发放，不改订单金额、历史账务或经营图表。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="h-9 border-[#FF9F0A]/20 bg-[#FF9F0A]/12 px-3 text-[#FFB340]">
            {pending.length ? `有 ${pending.length} 条新结算待处理` : "暂无待发放结算"}
          </Badge>
          <Button
            variant="outline"
            disabled={isChecking || isMutating}
            onClick={() => void runDueCheck()}
            className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white"
          >
            <RefreshCw className={`size-4 ${isChecking ? "animate-spin" : ""}`} />检查到期
          </Button>
        </div>
      </div>

      <section className={`${glassCard} flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5`}>
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-white/70">
            <CalendarClock className="size-4 text-[#64D2FF]" />手动生成当前周期
          </p>
          <p className="mt-1 text-[12px] text-white/35">提前结算会以当前时刻结束本周期，并从当前时刻重新起算。</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={selectedManualWorkerId} onValueChange={setManualWorkerId}>
            <SelectTrigger className={`${inputClass} min-w-48`}><SelectValue placeholder="选择打手" /></SelectTrigger>
            <SelectContent className="border-white/10 bg-[#242426] text-white">
              {workers.map((worker) => (
                <SelectItem key={worker.id} value={worker.id}>{worker.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!selectedManualWorkerId || isMutating}
            onClick={() => void generateNow()}
            className="h-11 rounded-xl bg-[#007AFF] text-white hover:bg-[#1685ff]"
          >
            <Banknote className="size-4" />立即生成
          </Button>
        </div>
      </section>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-11 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-1">
            <TabsTrigger value="pending" className="rounded-xl px-4 text-white/48 data-[state=active]:bg-white/[0.09] data-[state=active]:text-white">
              待发放 <span className="ml-1 text-[#FFB340]">{pending.length}</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-xl px-4 text-white/48 data-[state=active]:bg-white/[0.09] data-[state=active]:text-white">
              历史结算
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "history" ? (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-2 sm:grid-cols-3"
          >
            <Select value={workerFilter} onValueChange={setWorkerFilter}>
              <SelectTrigger className={`${inputClass} min-w-40`}><SelectValue /></SelectTrigger>
              <SelectContent className="border-white/10 bg-[#242426] text-white">
                <SelectItem value="all">全部打手</SelectItem>
                {historyWorkers.map(([workerId, workerName]) => (
                  <SelectItem key={workerId} value={workerId}>{workerName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input aria-label="开始日期" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={inputClass} />
            <Input aria-label="结束日期" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={inputClass} />
          </motion.div>
        ) : null}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {visibleRecords.map((record) => (
              <SettlementCard
                key={record.id}
                record={record}
                onView={setViewing}
              />
            ))}
          </AnimatePresence>
          {!visibleRecords.length ? (
            <div className={`${glassCard} grid min-h-64 place-content-center text-center`}>
              <WalletCards className="mx-auto mb-3 size-9 text-white/20" />
              <p className="text-sm text-white/40">
                {tab === "pending" ? "当前没有待发放结算" : "筛选范围内没有历史结算"}
              </p>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>

      <SettlementDetailDialog
        key={viewing?.id ?? "closed"}
        record={viewing}
        orders={orders}
        open={Boolean(viewing)}
        onOpenChange={(open) => !open && setViewing(null)}
      />
    </div>
  );
}
