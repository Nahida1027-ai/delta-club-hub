"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Coins,
  Gauge,
  History,
  LayoutDashboard,
  LockKeyhole,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { AddServiceModal } from "@/components/Modals/AddServiceModal";
import { AddWorkerModal } from "@/components/Modals/AddWorkerModal";
import { EditServiceModal } from "@/components/Modals/EditServiceModal";
import { OrderConfirmModal } from "@/components/Modals/OrderConfirmModal";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  Order,
  PriceMenuItem,
  SettlementResult,
  Worker,
  WorkerTier,
} from "@/lib/club-types";
import { calculateSettlement, splitLabel } from "@/lib/settlement";
import { useClubStore } from "@/store/use-club-store";
import { useClubWebMcp } from "@/hooks/use-club-webmcp";

const glassCard =
  "rounded-[22px] border border-white/[0.08] bg-[#1c1c1e]/75 shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur-md";
const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";
const dangerButtonClass =
  "border-[#FF3B30]/25 bg-[#FF3B30]/10 text-[#FF6961] hover:bg-[#FF3B30]/20 hover:text-white";
const chartColors = ["#0A84FF", "#64D2FF", "#5E5CE6", "#30D158", "#FFD60A", "#FF9F0A"];
const tiers: WorkerTier[] = ["1档", "2档", "3档"];

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(value);
}

function shortMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function chinaDateParts(iso: string) {
  const values = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  return Object.fromEntries(values.map((part) => [part.type, part.value]));
}

function monthKey(iso = new Date().toISOString()) {
  const parts = chinaDateParts(iso);
  return `${parts.year}-${parts.month}`;
}

function inMonth(iso: string | null, selectedMonth: string) {
  return Boolean(iso && monthKey(iso) === selectedMonth);
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function workerName(workers: Worker[], id: string, order?: Order) {
  return (
    workers.find((worker) => worker.id === id)?.name ??
    order?.pricing_snapshot.payout_weights.find((entry) => entry.workerId === id)?.workerName ??
    "未知打手"
  );
}

function AnimatedNumber({
  value,
  formatter = (next) => String(Math.round(next)),
}: {
  value: number;
  formatter?: (value: number) => string;
}) {
  const reducedMotion = useReducedMotion();
  const source = useMotionValue(0);
  const spring = useSpring(source, { stiffness: 130, damping: 24, mass: 0.7 });
  const [display, setDisplay] = useState(0);

  useMotionValueEvent(spring, "change", (latest) => setDisplay(latest));
  useEffect(() => {
    source.set(value);
  }, [source, value]);

  return <span>{formatter(reducedMotion ? value : display)}</span>;
}

function SectionTitle({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-1 text-sm font-semibold text-[#64D2FF]">{eyebrow}</p>
        <h2 className="text-2xl font-semibold tracking-[-0.035em] text-white sm:text-[28px]">
          {title}
        </h2>
        {detail ? <p className="mt-1.5 max-w-2xl text-[15px] leading-6 text-white/50">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

function SpringDialogPanel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className="grid gap-4 p-6"
    >
      {children}
    </motion.div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "blue",
  money = true,
  note,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "blue" | "green" | "violet" | "orange";
  money?: boolean;
  note: string;
}) {
  const tones = {
    blue: "bg-[#007AFF]/15 text-[#64D2FF]",
    green: "bg-[#30D158]/15 text-[#5FE778]",
    violet: "bg-[#5E5CE6]/18 text-[#A5A4FF]",
    orange: "bg-[#FF9F0A]/15 text-[#FFB340]",
  };
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${glassCard} relative overflow-hidden p-5`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white/45">{label}</p>
          <p className="mt-3 text-[clamp(1.6rem,2.4vw,2.15rem)] font-semibold tracking-[-0.045em] text-white">
            <AnimatedNumber
              value={value}
              formatter={money ? formatMoney : (next) => Math.round(next).toLocaleString("zh-CN")}
            />
          </p>
        </div>
        <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${tones[tone]}`}>
          <Icon className="size-5" />
        </span>
      </div>
      <p className="mt-4 text-[13px] text-white/35">{note}</p>
      <span className="absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
    </motion.article>
  );
}

function MonthPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white/55">
      <Clock3 className="size-4 text-[#64D2FF]" />
      <span className="sr-only">选择结算月份</span>
      <input
        type="month"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 bg-transparent font-medium text-white outline-none [color-scheme:dark]"
      />
    </label>
  );
}

function Dashboard({
  workers,
  orders,
  selectedMonth,
  onMonthChange,
}: {
  workers: Worker[];
  orders: Order[];
  selectedMonth: string;
  onMonthChange: (value: string) => void;
}) {
  const completed = useMemo(
    () => orders.filter((order) => order.status === "completed" && inMonth(order.completed_at, selectedMonth)),
    [orders, selectedMonth],
  );
  const clubIncome = completed.reduce((sum, order) => sum + (order.final_club_income ?? 0), 0);
  const workerExpense = completed.reduce(
    (sum, order) => sum + order.final_worker_incomes.reduce((inner, item) => inner + item.amount, 0),
    0,
  );
  const [year, month] = selectedMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dailyData = Array.from({ length: daysInMonth }, (_, index) => ({
    day: `${index + 1}日`,
    amount: completed
      .filter((order) => Number(chinaDateParts(order.completed_at!).day) === index + 1)
      .reduce((sum, order) => sum + (order.final_club_income ?? 0), 0),
  }));
  const workerData = workers
    .map((worker) => {
      const relevant = completed.filter((order) => order.assigned_worker_ids.includes(worker.id));
      return {
        id: worker.id,
        name: worker.name,
        tier: worker.tier,
        orders: relevant.length,
        income: relevant.reduce(
          (sum, order) =>
            sum + (order.final_worker_incomes.find((item) => item.workerId === worker.id)?.amount ?? 0),
          0,
        ),
      };
    })
    .sort((a, b) => b.income - a.income);
  const pieData = workerData.filter((worker) => worker.income > 0);

  return (
    <div className="space-y-8">
      <SectionTitle
        eyebrow="MONTHLY PULSE"
        title="本月经营总览"
        detail="账目按订单完成时间归档；进行中的订单不会提前计入收入。"
        action={<MonthPicker value={selectedMonth} onChange={onMonthChange} />}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="俱乐部总抽成" value={clubIncome} icon={CircleDollarSign} note="打赏不参与抽成" />
        <MetricCard label="打手总支出" value={workerExpense} icon={WalletCards} tone="violet" note="已完成订单实付合计" />
        <MetricCard label="本月净利润" value={clubIncome} icon={Gauge} tone="green" note="当前未计运营成本" />
        <MetricCard label="完成订单" value={completed.length} icon={ShieldCheck} tone="orange" money={false} note={`${orders.filter((order) => order.status === "active").length} 单正在进行`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
        <article className={`${glassCard} min-h-[360px] p-5 sm:p-6`}>
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">每日抽成走势</h3>
              <p className="mt-1 text-sm text-white/40">{selectedMonth.replace("-", " 年 ")} 月每日入账</p>
            </div>
            <Badge className="border-[#007AFF]/25 bg-[#007AFF]/10 text-[#64D2FF]">俱乐部收入</Badge>
          </div>
          <div className="h-[270px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="clubBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#64D2FF" />
                    <stop offset="100%" stopColor="#007AFF" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,.065)" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.38)", fontSize: 12 }} interval={Math.max(0, Math.floor(daysInMonth / 8) - 1)} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,.38)", fontSize: 12 }} tickFormatter={(value) => `¥${value}`} />
                <RechartsTooltip cursor={{ fill: "rgba(255,255,255,.035)" }} contentStyle={{ background: "rgba(28,28,30,.96)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, color: "white" }} formatter={(value) => [formatMoney(Number(value)), "俱乐部抽成"]} />
                <Bar dataKey="amount" fill="url(#clubBar)" radius={[5, 5, 2, 2]} maxBarSize={16} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className={`${glassCard} min-h-[360px] p-5 sm:p-6`}>
          <h3 className="text-lg font-semibold text-white">打手收入构成</h3>
          <p className="mt-1 text-sm text-white/40">按本月已完成订单实付金额</p>
          {pieData.length ? (
            <div className="mt-4 grid items-center gap-4 sm:grid-cols-[180px_1fr] xl:grid-cols-1 2xl:grid-cols-[180px_1fr]">
              <div className="relative mx-auto h-[190px] w-[190px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="income" nameKey="name" innerRadius={56} outerRadius={84} paddingAngle={3} stroke="none">
                      {pieData.map((entry, index) => <Cell key={entry.id} fill={chartColors[index % chartColors.length]} />)}
                    </Pie>
                    <RechartsTooltip contentStyle={{ background: "rgba(28,28,30,.96)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, color: "white" }} formatter={(value) => [formatMoney(Number(value)), "收入"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                  <span className="text-xs text-white/35">总支出</span>
                  <span className="mt-1 text-lg font-semibold text-white">{shortMoney(workerExpense)}</span>
                </div>
              </div>
              <div className="space-y-2.5">
                {pieData.map((entry, index) => (
                  <div key={entry.id} className="flex items-center justify-between gap-4 text-sm">
                    <span className="flex min-w-0 items-center gap-2 text-white/65">
                      <i className="size-2 rounded-full" style={{ background: chartColors[index % chartColors.length] }} />
                      <span className="truncate">{entry.name}</span>
                    </span>
                    <span className="font-medium text-white">{formatMoney(entry.income)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid h-[245px] place-content-center text-center text-white/35">
              <BarChart3 className="mx-auto mb-3 size-8" />
              <p className="text-sm">这个月还没有已结算订单</p>
            </div>
          )}
        </article>
      </div>

      <article className={`${glassCard} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-lg font-semibold text-white">打手个人业绩</h3>
            <p className="mt-1 text-sm text-white/40">本月完成单数与实际收入</p>
          </div>
          <Users className="size-5 text-[#64D2FF]" />
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-white/[0.07] hover:bg-transparent">
              <TableHead className="h-12 px-5 text-white/40 sm:px-6">打手</TableHead>
              <TableHead className="text-white/40">档位</TableHead>
              <TableHead className="text-right text-white/40">完成单数</TableHead>
              <TableHead className="pr-5 text-right text-white/40 sm:pr-6">本月收入</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workerData.map((worker, index) => (
              <TableRow key={worker.id} className="border-white/[0.06] hover:bg-white/[0.025]">
                <TableCell className="px-5 py-4 sm:px-6">
                  <span className="flex items-center gap-3 font-medium text-white">
                    <span className="grid size-8 place-items-center rounded-xl bg-white/[0.06] text-xs text-white/55">{index + 1}</span>
                    {worker.name}
                  </span>
                </TableCell>
                <TableCell><TierBadge tier={worker.tier} /></TableCell>
                <TableCell className="text-right font-medium text-white/70">{worker.orders}</TableCell>
                <TableCell className="pr-5 text-right font-semibold text-white sm:pr-6">{formatMoney(worker.income)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </article>
    </div>
  );
}

function TierBadge({ tier }: { tier: WorkerTier }) {
  const styles = {
    "1档": "border-[#FFD60A]/25 bg-[#FFD60A]/10 text-[#FFE36E]",
    "2档": "border-[#64D2FF]/25 bg-[#64D2FF]/10 text-[#8BE0FF]",
    "3档": "border-white/10 bg-white/[0.055] text-white/55",
  };
  return <Badge className={styles[tier]}>{tier}</Badge>;
}

function ServiceRule({ item }: { item: PriceMenuItem }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      {item.commission_mode === "by_tier" ? (
        <>
          <span className="rounded-lg bg-[#007AFF]/10 px-2.5 py-1 text-[#64D2FF]">按档位抽成</span>
          <span className="rounded-lg bg-white/[0.055] px-2.5 py-1 text-white/55">
            1档 {item.tier_commission_rates["1档"]}% · 2档 {item.tier_commission_rates["2档"]}% · 3档 {item.tier_commission_rates["3档"]}%
          </span>
        </>
      ) : (
        <span className="rounded-lg bg-white/[0.055] px-2.5 py-1 text-white/55">统一抽成 {item.club_commission_rate}%</span>
      )}
      <span className="rounded-lg bg-white/[0.055] px-2.5 py-1 text-white/55">{splitLabel(item.split_type)}</span>
      {item.split_type === "tiered" && item.tiered_ratios ? (
        <span className="rounded-lg bg-[#5E5CE6]/12 px-2.5 py-1 text-[#A5A4FF]">
          1档 {item.tiered_ratios["1档"]}% · 2档 {item.tiered_ratios["2档"]}%
        </span>
      ) : null}
    </div>
  );
}

function OrderDesk({
  menu,
  workers,
  orders,
}: {
  menu: PriceMenuItem[];
  workers: Worker[];
  orders: Order[];
}) {
  const isMutating = useClubStore((state) => state.is_mutating);
  const [confirmation, setConfirmation] = useState<{
    item: PriceMenuItem;
    initialWorkerIds: string[];
  } | null>(null);
  const activeOrders = orders.filter((order) => order.status === "active");

  function autoAssign(item: PriceMenuItem) {
    const recommended = workers.find(
      (worker) => worker.status === "idle" && item.eligible_tiers.includes(worker.tier),
    );
    if (!recommended) {
      toast.error("暂无匹配的空闲打手");
      return;
    }
    setConfirmation({ item, initialWorkerIds: [recommended.id] });
  }

  return (
    <div className="space-y-8">
      <SectionTitle eyebrow="ORDER DESK" title="老板点单" detail="服务规则在下单瞬间冻结，后续调价不会改变这张订单。" />
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {menu.map((item, index) => {
          const available = workers.filter(
            (worker) => worker.status === "idle" && item.eligible_tiers.includes(worker.tier),
          ).length;
          return (
            <motion.article
              layout
              key={item.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -48, scale: 0.98 }}
              transition={{ delay: index * 0.05 }}
              className={`${glassCard} group relative flex h-full flex-col overflow-hidden p-5 sm:p-6`}
            >
              <div className="absolute -right-10 -top-10 size-32 rounded-full bg-[#007AFF]/10 blur-3xl transition group-hover:bg-[#007AFF]/18" />
              <div className="relative flex h-full flex-1 flex-col">
                <div className="flex items-start justify-between gap-4">
                  <span className="grid size-11 place-items-center rounded-2xl bg-[#007AFF]/14 text-[#64D2FF]">
                    {item.split_type === "single" ? <Target className="size-5" /> : item.split_type === "equal" ? <Users className="size-5" /> : <Sparkles className="size-5" />}
                  </span>
                  <span className="text-sm text-white/35">{available} 人可接</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-white">{item.service_name}</h3>
                <p className="mt-2 text-[32px] font-semibold tracking-[-0.045em] text-white">{formatMoney(item.base_price)}</p>
                <div className="mt-4"><ServiceRule item={item} /></div>
                {!available || (item.split_type !== "single" && available < 2) ? (
                  <p className="mt-3 text-sm text-[#FF6961]">匹配的空闲打手不足，暂时无法派单</p>
                ) : null}
                <div className="mt-auto flex gap-2 pt-6">
                  {item.split_type === "single" ? (
                    <>
                      <Button disabled={!available || isMutating} onClick={() => autoAssign(item)} className="h-11 flex-1 rounded-xl bg-[#007AFF] text-white hover:bg-[#1685ff]">
                        <Zap className="size-4" />自动派单
                      </Button>
                      <Button disabled={!available || isMutating} variant="outline" onClick={() => setConfirmation({ item, initialWorkerIds: [] })} className="h-11 rounded-xl border-white/10 bg-white/[0.045] text-white hover:bg-white/10 hover:text-white">
                        手动选择
                      </Button>
                    </>
                  ) : (
                    <Button disabled={available < 2 || isMutating} onClick={() => setConfirmation({ item, initialWorkerIds: [] })} className="h-11 w-full rounded-xl bg-[#007AFF] text-white hover:bg-[#1685ff]">
                      选择 2 名打手<ChevronRight className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </motion.article>
          );
          })}
        </AnimatePresence>
      </div>

      <article className={`${glassCard} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-lg font-semibold text-white">进行中订单</h3>
            <p className="mt-1 text-sm text-white/40">打手将在结束结算前保持锁定</p>
          </div>
          <Badge className="border-[#FF453A]/25 bg-[#FF453A]/10 text-[#FF6961]">{activeOrders.length} 单进行中</Badge>
        </div>
        {activeOrders.length ? (
          <div className="divide-y divide-white/[0.06]">
            {activeOrders.map((order) => (
              <div key={order.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-6">
                <div>
                  <p className="font-medium text-white">{order.pricing_snapshot.service_name}</p>
                  <p className="mt-1 text-sm text-white/38">
                    #{order.id.slice(0, 8)} · {formatDateTime(order.created_at)} · {formatMoney(order.total_price)}
                  </p>
                  {order.special_requirements.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge className="border-[#5E5CE6]/20 bg-[#5E5CE6]/10 text-[#C4C3FF]">
                        特殊需求 × {order.special_requirements.length}
                      </Badge>
                      <Badge className="border-[#007AFF]/20 bg-[#007AFF]/10 text-[#64D2FF]">
                        +{formatMoney(order.special_total)}
                      </Badge>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {order.assigned_worker_ids.map((id) => <Badge key={id} className="border-white/10 bg-white/[0.055] text-white/65">{workerName(workers, id, order)}</Badge>)}
                </div>
                <span className="flex items-center gap-2 text-sm text-[#FF6961]"><span className="status-dot" data-status="busy" />执行中</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-sm text-white/35">当前没有进行中的订单</div>
        )}
      </article>

      <OrderConfirmModal
        key={confirmation ? `${confirmation.item.id}:${confirmation.initialWorkerIds.join(",")}` : "closed"}
        item={confirmation?.item ?? null}
        workers={workers}
        initialWorkerIds={confirmation?.initialWorkerIds ?? []}
        open={Boolean(confirmation)}
        onOpenChange={(open) => !open && setConfirmation(null)}
      />
    </div>
  );
}

function WorkerBoard({ workers, orders }: { workers: Worker[]; orders: Order[] }) {
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState<Order | null>(null);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [deleting, setDeleting] = useState<Worker | null>(null);
  const [reassigning, setReassigning] = useState<{ order: Order; worker: Worker } | null>(null);
  const deleteWorker = useClubStore((state) => state.deleteWorker);
  const cancelAndReassign = useClubStore((state) => state.cancelAndReassign);
  const isMutating = useClubStore((state) => state.is_mutating);

  async function confirmDeleteWorker() {
    if (!deleting) return;
    try {
      const name = deleting.name;
      await deleteWorker(deleting.id);
      toast.success(`${name} 及其关联订单已删除`);
      setDeleting(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function confirmReassignment() {
    if (!reassigning) return;
    try {
      const previousName = reassigning.worker.name;
      const result = await cancelAndReassign(
        reassigning.order.id,
        reassigning.worker.id,
      );
      toast.success(`${previousName} 已释放，新订单已派给 ${result.newWorkerName}`);
      setReassigning(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "换人失败");
    }
  }

  return (
    <div className="space-y-8">
      <SectionTitle
        eyebrow="WORKER FLOOR"
        title="打手状态看板"
        detail="忙碌状态会锁定接单资格；双人订单从任一打手卡结束都会同时释放两人。"
        action={(
          <Button
            variant="outline"
            disabled={isMutating}
            onClick={() => setAdding(true)}
            className="h-11 rounded-2xl border-[#007AFF]/30 bg-[#007AFF]/12 px-4 text-[#64D2FF] shadow-[0_10px_30px_rgba(0,122,255,.12)] backdrop-blur-xl hover:bg-[#007AFF]/22 hover:text-white"
          >
            <Plus className="size-4" />添加打手
          </Button>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AnimatePresence mode="popLayout">
          {workers.map((worker, index) => {
            const activeOrder = orders.find(
              (order) => order.status === "active" && order.assigned_worker_ids.includes(worker.id),
            );
            const busy = worker.status === "busy";
            return (
              <motion.article
                layout
                key={worker.id}
                initial={{ opacity: 0, scale: 0.96, y: 20 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: busy ? 1.012 : 1,
                  boxShadow: busy
                    ? "0 22px 58px rgba(255,69,58,.12)"
                    : "0 18px 48px rgba(0,0,0,.2)",
                }}
                exit={{ opacity: 0, scale: 0.94, y: 12 }}
                transition={{ type: "spring", stiffness: 230, damping: 23, delay: index * 0.025 }}
                className={`${glassCard} overflow-hidden p-5`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`grid size-12 shrink-0 place-items-center rounded-2xl text-lg font-semibold ${busy ? "bg-[#FF453A]/12 text-[#FF6961]" : "bg-[#30D158]/12 text-[#5FE778]"}`}>
                      {worker.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold text-white">{worker.name}</h3>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="status-dot" data-status={worker.status} />
                        <span className={busy ? "text-sm text-[#FF6961]" : "text-sm text-[#5FE778]"}>{busy ? "忙碌" : "空闲"}</span>
                      </div>
                    </div>
                  </div>
                  <TierBadge tier={worker.tier} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isMutating}
                    onClick={() => setEditing(worker)}
                    className="h-9 rounded-xl border-[#007AFF]/25 bg-[#007AFF]/10 text-[#64D2FF] hover:bg-[#007AFF]/20 hover:text-white"
                  >
                    <PencilLine className="size-3.5" />编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isMutating}
                    onClick={() => {
                      if (busy) {
                        toast.error("该打手正在接单，无法删除");
                        return;
                      }
                      setDeleting(worker);
                    }}
                    className={`h-9 rounded-xl ${dangerButtonClass}`}
                  >
                    <Trash2 className="size-3.5" />删除
                  </Button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <p className="text-[12px] text-white/35">累计完成</p>
                    <p className="mt-1 text-lg font-semibold text-white">{worker.total_completed_orders} 单</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                    <p className="text-[12px] text-white/35">当前状态</p>
                    <p className="mt-1 text-lg font-semibold text-white">{busy ? "执行中" : "待命"}</p>
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {activeOrder ? (
                    <motion.div
                      key={activeOrder.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4"
                    >
                      <div className="rounded-xl border border-[#FF453A]/15 bg-[#FF453A]/[0.055] p-3">
                        <p className="truncate text-sm font-medium text-white/85">{activeOrder.pricing_snapshot.service_name}</p>
                        <p className="mt-1 text-[12px] text-white/35">订单 #{activeOrder.id.slice(0, 8)}</p>
                        {activeOrder.special_requirements.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="rounded-md bg-[#5E5CE6]/15 px-2 py-1 text-[11px] text-[#C4C3FF]">
                              特殊需求 × {activeOrder.special_requirements.length}
                            </span>
                            <span className="rounded-md bg-[#007AFF]/15 px-2 py-1 text-[11px] text-[#64D2FF]">
                              +{formatMoney(activeOrder.special_total)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button onClick={() => setFinishing(activeOrder)} disabled={isMutating} className="h-11 rounded-xl bg-white text-[#1C1C1E] hover:bg-white/90">
                          <Check className="size-4" />打单结束
                        </Button>
                        <Button
                          variant="outline"
                          disabled={isMutating}
                          onClick={() => setReassigning({ order: activeOrder, worker })}
                          className={`h-11 rounded-xl ${dangerButtonClass}`}
                        >
                          <RefreshCw className="size-4" />老板换人
                        </Button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 flex h-11 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-white/28">
                      等待新订单
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
      <AddWorkerModal
        key={adding ? "open" : "closed"}
        open={adding}
        onOpenChange={setAdding}
      />
      <FinishOrderDialog
        key={finishing?.id ?? "closed"}
        order={finishing}
        workers={workers}
        open={Boolean(finishing)}
        onOpenChange={(open) => !open && setFinishing(null)}
      />
      <EditWorkerDialog
        key={editing?.id ?? "closed"}
        worker={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <DangerConfirmDialog
        open={Boolean(deleting)}
        title="删除打手"
        description="确定要删除该打手吗？此操作不可撤销。该打手的所有历史订单及对应收入也会同步移除。"
        confirmLabel="确认删除"
        icon={Trash2}
        isMutating={isMutating}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={confirmDeleteWorker}
      />
      <DangerConfirmDialog
        open={Boolean(reassigning)}
        title="老板申请换人"
        description="确定取消该打手的当前订单并重新指派吗？该打手将不计业绩且无收入。若没有符合规则的空闲打手，原订单会保持不变。"
        confirmLabel="确认换人"
        icon={RefreshCw}
        isMutating={isMutating}
        onOpenChange={(open) => !open && setReassigning(null)}
        onConfirm={confirmReassignment}
      />
    </div>
  );
}

function EditWorkerDialog({
  worker,
  open,
  onOpenChange,
}: {
  worker: Worker | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateWorker = useClubStore((state) => state.updateWorker);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [name, setName] = useState(worker?.name ?? "");
  const [tier, setTier] = useState<WorkerTier>(worker?.tier ?? "1档");

  if (!worker) return null;
  const busy = worker.status === "busy";

  async function save() {
    if (!name.trim()) return;
    try {
      await updateWorker(worker!.id, { name, tier });
      toast.success("打手信息已更新");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl sm:max-w-md">
        <SpringDialogPanel>
          <DialogHeader>
            <DialogTitle className="text-xl">编辑打手信息</DialogTitle>
            <DialogDescription className="text-white/45">姓名会立即同步到看板、接单列表与排行榜。</DialogDescription>
          </DialogHeader>
          <label className="space-y-2">
            <span className="text-sm font-medium text-white/65">打手姓名</span>
            <Input value={name} maxLength={32} onChange={(event) => setName(event.target.value)} className={inputClass} autoFocus />
          </label>
          <label className="space-y-2">
            <span className="flex items-center justify-between text-sm font-medium text-white/65">
              <span>档位</span>
              {busy ? <span className="text-[#FF6961]">接单中已锁定</span> : null}
            </span>
            <Select value={tier} disabled={busy} onValueChange={(value) => setTier(value as WorkerTier)}>
              <SelectTrigger className={`${inputClass} w-full disabled:cursor-not-allowed disabled:opacity-45`}><SelectValue /></SelectTrigger>
              <SelectContent className="border-white/10 bg-[#242426] text-white">
                {tiers.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
            {busy ? <p className="text-[13px] leading-5 text-white/40">该打手正在执行订单，本次只能修改姓名。</p> : null}
          </label>
          <DialogFooter>
            <Button variant="ghost" className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white" onClick={() => onOpenChange(false)}>取消</Button>
            <Button className="h-11 rounded-xl bg-[#007AFF] text-white hover:bg-[#1685ff]" disabled={!name.trim() || isMutating} onClick={save}>{isMutating ? "正在保存…" : "保存修改"}</Button>
          </DialogFooter>
        </SpringDialogPanel>
      </DialogContent>
    </Dialog>
  );
}

function DangerConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  icon: Icon,
  isMutating,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  isMutating: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl">
        <SpringDialogPanel>
          <AlertDialogHeader>
            <AlertDialogMedia className="mb-2 size-12 rounded-2xl bg-[#FF3B30]/12 text-[#FF6961]">
              <Icon className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle className="text-xl">{title}</AlertDialogTitle>
            <AlertDialogDescription className="leading-6 text-white/45">{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating} className="h-11 rounded-xl border-white/10 bg-white/[0.045] text-white/65 hover:bg-white/10 hover:text-white">取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isMutating}
              onClick={(event) => {
                event.preventDefault();
                void onConfirm();
              }}
              className="h-11 rounded-xl bg-[#FF3B30] text-white hover:bg-[#ff5047]"
            >
              {isMutating ? "正在处理…" : confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </SpringDialogPanel>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function FinishOrderDialog({
  order,
  workers,
  open,
  onOpenChange,
}: {
  order: Order | null;
  workers: Worker[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const finishOrder = useClubStore((state) => state.finishOrder);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [tipInput, setTipInput] = useState("0");

  if (!order) return null;
  const tip = Number(tipInput);
  let preview: SettlementResult | null = null;
  let errorMessage = "";
  try {
    if (tipInput.trim() === "" || !/^\d+(\.\d{0,2})?$/.test(tipInput) || tip < 0) {
      throw new Error("打赏金额需为非负数字，最多两位小数");
    }
    preview = calculateSettlement(order.pricing_snapshot, tip, order.order_original_total);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "金额无效";
  }

  async function confirm() {
    if (!preview) return;
    try {
      const result = await finishOrder(order!.id, tip);
      toast.success(`结算完成：俱乐部 ${formatMoney(result.club_income)}，打手 ${formatMoney(result.worker_pool)}`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "结算失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#171719]/95 text-white shadow-2xl backdrop-blur-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">结束订单并结算</DialogTitle>
          <DialogDescription className="text-white/45">{order.pricing_snapshot.service_name} · #{order.id.slice(0, 8)}</DialogDescription>
        </DialogHeader>
        <div>
          <label htmlFor="tip" className="mb-2 block text-sm font-medium text-white/65">老板打赏金额</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/35">¥</span>
            <Input id="tip" inputMode="decimal" value={tipInput} onChange={(event) => setTipInput(event.target.value)} className={`${inputClass} pl-8`} aria-invalid={Boolean(errorMessage)} />
          </div>
          <p className="mt-2 text-[13px] text-[#64D2FF]">打赏不参与抽成，100% 进入打手分配池。</p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/20">
          <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.07] border-b border-white/[0.07] sm:grid-cols-4 sm:divide-y-0">
            <div className="p-3 text-center"><p className="text-[12px] text-white/35">订单原价</p><p className="mt-1 text-sm font-semibold">{formatMoney(order.order_original_total)}</p></div>
            <div className="p-3 text-center"><p className="text-[12px] text-white/35">特殊加价</p><p className="mt-1 text-sm font-semibold text-[#C4C3FF]">+{formatMoney(order.special_total)}</p></div>
            <div className="p-3 text-center"><p className="text-[12px] text-white/35">俱乐部</p><p className="mt-1 text-sm font-semibold text-[#64D2FF]">{preview ? formatMoney(preview.club_income) : "—"}</p></div>
            <div className="p-3 text-center"><p className="text-[12px] text-white/35">打手池</p><p className="mt-1 text-sm font-semibold text-[#5FE778]">{preview ? formatMoney(preview.worker_pool) : "—"}</p></div>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {order.pricing_snapshot.payout_weights.map((weight) => {
              const income = preview?.worker_incomes.find((item) => item.workerId === weight.workerId);
              return (
                <div key={weight.workerId} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span className="flex items-center gap-2 text-white/60">{workerName(workers, weight.workerId, order)}<TierBadge tier={weight.tier} /><span className="text-white/30">{weight.weight}%</span></span>
                  <span className="font-semibold text-white">{income ? formatMoney(income.amount) : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
        {errorMessage ? <p className="text-sm text-[#FF6961]">{errorMessage}</p> : null}
        <DialogFooter>
          <Button variant="ghost" className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white" onClick={() => onOpenChange(false)}>取消</Button>
          <Button className="h-11 rounded-xl bg-[#007AFF] text-white hover:bg-[#1685ff]" disabled={!preview || isMutating} onClick={confirm}>{isMutating ? "正在落账…" : "确认结算"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceMenuPanel({ menu }: { menu: PriceMenuItem[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PriceMenuItem | null>(null);
  const [deleting, setDeleting] = useState<PriceMenuItem | null>(null);
  const deleteMenuItem = useClubStore((state) => state.deleteMenuItem);
  const isMutating = useClubStore((state) => state.is_mutating);

  async function confirmDeleteMenuItem() {
    if (!deleting) return;
    try {
      const serviceName = deleting.service_name;
      await deleteMenuItem(deleting.id);
      toast.success(`${serviceName} 已删除，历史订单保持不变`);
      setDeleting(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除服务失败");
    }
  }

  return (
    <div className="space-y-8">
      <SectionTitle
        eyebrow="RULE ENGINE"
        title="价格表管理"
        detail="每项服务独立设置抽成与分配方式；修改只作用于后续新订单。"
        action={(
          <Button
            variant="outline"
            disabled={isMutating}
            onClick={() => setAdding(true)}
            className="h-11 rounded-2xl border-[#007AFF]/30 bg-[#007AFF]/12 px-4 text-[#64D2FF] shadow-[0_10px_30px_rgba(0,122,255,.12)] backdrop-blur-xl hover:bg-[#007AFF]/22 hover:text-white"
          >
            <Plus className="size-4" />添加服务
          </Button>
        )}
      />
      <article className={`${glassCard} overflow-hidden`}>
        <Table>
          <TableHeader>
            <TableRow className="border-white/[0.07] hover:bg-transparent">
              <TableHead className="h-12 px-5 text-white/40 sm:px-6">服务项目</TableHead>
              <TableHead className="text-white/40">基础单价</TableHead>
              <TableHead className="text-white/40">俱乐部抽成</TableHead>
              <TableHead className="text-white/40">分配模式</TableHead>
              <TableHead className="text-white/40">可接档位</TableHead>
              <TableHead className="pr-5 text-right text-white/40 sm:pr-6">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence initial={false} mode="popLayout">
              {menu.map((item) => (
              <motion.tr
                layout
                key={item.id}
                initial={{ opacity: 0, x: 56 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -56 }}
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
                className="border-b border-white/[0.06] transition-colors hover:bg-white/[0.025]"
              >
                <TableCell className="px-5 py-5 font-medium text-white sm:px-6">{item.service_name}</TableCell>
                <TableCell className="font-semibold text-white">{formatMoney(item.base_price)}</TableCell>
                <TableCell>
                  {item.commission_mode === "by_tier" ? (
                    <div>
                      <span className="rounded-lg bg-[#007AFF]/10 px-2.5 py-1 font-medium text-[#64D2FF]">按档位</span>
                      <p className="mt-2 whitespace-nowrap text-[12px] text-white/38">
                        1档 {item.tier_commission_rates["1档"]}% / 2档 {item.tier_commission_rates["2档"]}% / 3档 {item.tier_commission_rates["3档"]}%
                      </p>
                    </div>
                  ) : (
                    <span className="rounded-lg bg-[#007AFF]/10 px-2.5 py-1 font-medium text-[#64D2FF]">统一 {item.club_commission_rate}%</span>
                  )}
                </TableCell>
                <TableCell>
                  <div>
                    <span className="text-white/70">{splitLabel(item.split_type)}</span>
                    {item.split_type === "tiered" && item.tiered_ratios ? <p className="mt-1 text-[12px] text-white/35">1档 {item.tiered_ratios["1档"]}% / 2档 {item.tiered_ratios["2档"]}%</p> : null}
                  </div>
                </TableCell>
                <TableCell><div className="flex gap-1">{item.eligible_tiers.map((tier) => <TierBadge key={tier} tier={tier} />)}</div></TableCell>
                <TableCell className="pr-5 text-right sm:pr-6">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" disabled={isMutating} onClick={() => setEditing(item)} className="rounded-lg border-[#007AFF]/25 bg-[#007AFF]/10 text-[#64D2FF] hover:bg-[#007AFF]/20 hover:text-white"><PencilLine className="size-3.5" />编辑</Button>
                    <Button variant="outline" size="sm" disabled={isMutating} onClick={() => setDeleting(item)} className={`rounded-lg ${dangerButtonClass}`}><Trash2 className="size-3.5" />删除</Button>
                  </div>
                </TableCell>
              </motion.tr>
              ))}
            </AnimatePresence>
          </TableBody>
        </Table>
      </article>
      <div className="grid gap-4 md:grid-cols-3">
        <RuleNote icon={LockKeyhole} title="订单规则快照" text="创建订单时冻结价格、档位抽成、模式和权重；旧单永远不被新规则改写。" />
        <RuleNote icon={Coins} title="加价参与抽成" text="基础价与特殊需求加价共同参与抽成；打赏仍完整进入打手分配池。" />
        <RuleNote icon={ShieldCheck} title="金额守恒" text="按整数分结算并自动处理尾差，所有收入相加始终等于订单总额。" />
      </div>
      <AddServiceModal
        key={adding ? "open" : "closed"}
        open={adding}
        onOpenChange={setAdding}
      />
      <EditServiceModal key={editing?.id ?? "closed"} item={editing} open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)} />
      <DangerConfirmDialog
        open={Boolean(deleting)}
        title="删除价格表服务"
        description="确定要删除该服务吗？删除后不可恢复，但历史订单不受影响。"
        confirmLabel="删除服务"
        icon={Trash2}
        isMutating={isMutating}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={confirmDeleteMenuItem}
      />
    </div>
  );
}

function RuleNote({ icon: Icon, title, text }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <article className={`${glassCard} flex gap-4 p-5`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#007AFF]/12 text-[#64D2FF]"><Icon className="size-5" /></span>
      <div><h3 className="font-semibold text-white">{title}</h3><p className="mt-1 text-sm leading-6 text-white/42">{text}</p></div>
    </article>
  );
}

function OrderHistoryItem({
  order,
  workers,
  isMutating,
  onDelete,
}: {
  order: Order;
  workers: Worker[];
  isMutating: boolean;
  onDelete: (order: Order) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const commissionText = order.pricing_snapshot.commission_mode === "by_tier"
    ? `档位抽成 1档 ${order.pricing_snapshot.tier_commission_rates["1档"]}% / 2档 ${order.pricing_snapshot.tier_commission_rates["2档"]}% / 3档 ${order.pricing_snapshot.tier_commission_rates["3档"]}%`
    : `统一抽成 ${order.pricing_snapshot.club_commission_rate}%`;

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 72, scale: 0.98 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="border-b border-white/[0.06] align-top transition-colors hover:bg-white/[0.025]"
    >
      <TableCell className="px-5 py-4 sm:px-6">
        <p className="font-mono text-[13px] text-white/65">#{order.id.slice(0, 8)}</p>
        <p className="mt-1 text-[12px] text-white/32">{formatDateTime(order.completed_at)}</p>
      </TableCell>
      <TableCell className="min-w-72 py-4">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="group w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/60"
        >
          <span className="flex items-start justify-between gap-3">
            <span>
              <span className="block font-medium text-white">{order.pricing_snapshot.service_name}</span>
              <span className="mt-1 block text-[12px] text-white/35">
                {formatMoney(order.total_price)} · {commissionText} · {splitLabel(order.pricing_snapshot.split_type)}
              </span>
            </span>
            <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-[#64D2FF]">
              {expanded ? "收起" : "明细"}
              <motion.span animate={{ rotate: expanded ? 180 : 0 }}>
                <ChevronDown className="size-3.5" />
              </motion.span>
            </span>
          </span>
        </button>
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-white/48">
                  <span>基础价格</span><span className="text-right text-white/75">{formatMoney(order.base_price_snapshot)}</span>
                  <span>特殊需求加价</span><span className="text-right text-[#C4C3FF]">+{formatMoney(order.special_total)}</span>
                  <span>订单总价</span><span className="text-right font-medium text-white">{formatMoney(order.total_price)}</span>
                  <span>打赏</span><span className="text-right text-[#FFB65C]">+{formatMoney(order.tip)}</span>
                  <span>俱乐部实得</span><span className="text-right text-[#64D2FF]">{formatMoney(order.final_club_income ?? 0)}</span>
                </div>
                <div className="mt-3 border-t border-white/[0.06] pt-3">
                  <p className="mb-2 text-white/40">特殊需求明细</p>
                  {order.special_requirements.length ? (
                    <div className="space-y-1.5">
                      {order.special_requirements.map((requirement, index) => (
                        <div key={`${requirement.name}-${index}`} className="flex justify-between gap-3 text-white/65">
                          <span className="truncate">{requirement.name}</span>
                          <span className="shrink-0">+{formatMoney(requirement.price)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-white/28">无特殊需求</p>
                  )}
                </div>
                <div className="mt-3 border-t border-white/[0.06] pt-3">
                  <p className="mb-2 text-white/40">打手实得</p>
                  <div className="space-y-1.5">
                    {order.final_worker_incomes.map((income) => (
                      <div key={income.workerId} className="flex justify-between gap-3 text-white/65">
                        <span>{workerName(workers, income.workerId, order)}</span>
                        <span className="font-medium text-[#5FE778]">{formatMoney(income.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </TableCell>
      <TableCell className="py-4">
        <div className="space-y-1">
          {order.final_worker_incomes.map((income) => (
            <p key={income.workerId} className="text-sm text-white/65">
              {workerName(workers, income.workerId, order)} <span className="font-medium text-white">{formatMoney(income.amount)}</span>
            </p>
          ))}
        </div>
      </TableCell>
      <TableCell className="py-4 text-right text-white/65">{formatMoney(order.tip)}</TableCell>
      <TableCell className="py-4 text-right font-semibold text-[#64D2FF]">{formatMoney(order.final_club_income ?? 0)}</TableCell>
      <TableCell className="py-4 pr-5 text-right sm:pr-6">
        <Button
          variant="outline"
          size="sm"
          disabled={isMutating}
          onClick={() => onDelete(order)}
          className={`h-9 rounded-xl ${dangerButtonClass}`}
        >
          <Trash2 className="size-3.5" />删除
        </Button>
      </TableCell>
    </motion.tr>
  );
}

function HistoryPanel({
  workers,
  orders,
  selectedMonth,
  onMonthChange,
}: {
  workers: Worker[];
  orders: Order[];
  selectedMonth: string;
  onMonthChange: (value: string) => void;
}) {
  const deleteHistoricalOrder = useClubStore((state) => state.deleteHistoricalOrder);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const completed = orders.filter(
    (order) => order.status === "completed" && inMonth(order.completed_at, selectedMonth),
  );
  const clubIncome = completed.reduce((sum, order) => sum + (order.final_club_income ?? 0), 0);
  const workerExpense = completed.reduce(
    (sum, order) => sum + order.final_worker_incomes.reduce((inner, income) => inner + income.amount, 0),
    0,
  );
  const tips = completed.reduce((sum, order) => sum + order.tip, 0);

  async function confirmDeleteOrder() {
    if (!deletingOrder) return;
    try {
      await deleteHistoricalOrder(deletingOrder.id);
      toast.success("历史订单已删除，相关收入与业绩已同步回退");
      setDeletingOrder(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  }

  return (
    <div className="space-y-8">
      <SectionTitle
        eyebrow="LEDGER"
        title="订单与月底结算"
        detail="所有已完成订单永久归档；月报直接汇总订单最终落账字段，不按当前价格表重算。"
        action={<MonthPicker value={selectedMonth} onChange={onMonthChange} />}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="俱乐部入账" value={clubIncome} icon={CircleDollarSign} note={`${completed.length} 张已完成订单`} />
        <MetricCard label="打手应付" value={workerExpense} icon={WalletCards} tone="violet" note="按个人实得金额汇总" />
        <MetricCard label="老板打赏" value={tips} icon={Sparkles} tone="orange" note="已全额分配给打手" />
      </div>
      <article className={`${glassCard} overflow-hidden`}>
        {completed.length ? (
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.07] hover:bg-transparent">
                <TableHead className="h-12 px-5 text-white/40 sm:px-6">订单 / 完成时间</TableHead>
                <TableHead className="text-white/40">服务与规则</TableHead>
                <TableHead className="text-white/40">打手实得</TableHead>
                <TableHead className="text-right text-white/40">打赏</TableHead>
                <TableHead className="text-right text-white/40">俱乐部入账</TableHead>
                <TableHead className="pr-5 text-right text-white/40 sm:pr-6">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence initial={false} mode="popLayout">
                {completed.map((order) => (
                  <OrderHistoryItem
                    key={order.id}
                    order={order}
                    workers={workers}
                    isMutating={isMutating}
                    onDelete={setDeletingOrder}
                  />
                ))}
              </AnimatePresence>
            </TableBody>
          </Table>
        ) : (
          <div className="grid min-h-60 place-content-center text-center">
            <History className="mx-auto mb-3 size-8 text-white/25" />
            <p className="text-sm text-white/38">这个月还没有已完成订单</p>
          </div>
        )}
      </article>
      <DangerConfirmDialog
        open={Boolean(deletingOrder)}
        title="删除历史订单"
        description="删除该订单将同步扣减打手和俱乐部的收入，确定删除吗？"
        confirmLabel="删除订单"
        icon={Trash2}
        isMutating={isMutating}
        onOpenChange={(open) => !open && setDeletingOrder(null)}
        onConfirm={confirmDeleteOrder}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <main className="min-h-screen bg-[#090A0D] text-white">
      <div className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 xl:px-8">
        <div className="mb-10 flex items-center gap-3">
          <div className="size-11 animate-pulse rounded-2xl bg-[#007AFF]/25" />
          <div><div className="h-4 w-44 animate-pulse rounded bg-white/10" /><div className="mt-2 h-3 w-28 animate-pulse rounded bg-white/[0.06]" /></div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className={`${glassCard} h-36 animate-pulse bg-white/[0.035]`} />)}
        </div>
        <div className={`${glassCard} mt-4 grid h-80 place-content-center`}>
          <RefreshCw className="mx-auto size-6 animate-spin text-[#64D2FF]" />
          <p className="mt-3 text-sm text-white/40">正在同步俱乐部账本…</p>
        </div>
      </div>
    </main>
  );
}

export function ClubHub() {
  useClubWebMcp();
  const workers = useClubStore((state) => state.workers);
  const menu = useClubStore((state) => state.menu);
  const orders = useClubStore((state) => state.orders);
  const isReady = useClubStore((state) => state.is_ready);
  const isLoading = useClubStore((state) => state.is_loading);
  const error = useClubStore((state) => state.error);
  const lastSyncedAt = useClubStore((state) => state.last_synced_at);
  const load = useClubStore((state) => state.load);
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey());
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    void load();
  }, [load]);

  if (!isReady) return <LoadingState />;

  const activeCount = orders.filter((order) => order.status === "active").length;
  const navItems = [
    { value: "dashboard", label: "总览", icon: LayoutDashboard },
    { value: "orders", label: "接单台", icon: Play },
    { value: "workers", label: "打手看板", icon: Users },
    { value: "pricing", label: "价格表管理", icon: Settings2 },
    { value: "history", label: "订单与结算", icon: History },
  ];

  return (
    <main className="min-h-screen bg-[#090A0D] text-white selection:bg-[#007AFF]/35">
      <div className="ambient-grid fixed inset-0 pointer-events-none" />
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#090A0D]/78 backdrop-blur-2xl">
        <div className="mx-auto flex min-h-[76px] max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 xl:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#007AFF] text-sm font-black tracking-[-0.06em] text-white shadow-[0_10px_30px_rgba(0,122,255,.32)]">DF<span className="absolute inset-x-2 bottom-1 h-px bg-white/35" /></span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-[-0.02em] text-white sm:text-lg">Delta Force Club Hub</h1>
              <p className="mt-0.5 hidden text-[13px] text-white/35 sm:block">订单调度与自动结算中枢</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 md:flex">
              <span className="status-dot" data-status={error ? "busy" : "idle"} />
              <span className="text-sm text-white/48">{error ? "同步异常" : lastSyncedAt ? "账本已同步" : "准备同步"}</span>
            </div>
            <Badge className="border-[#FF453A]/20 bg-[#FF453A]/10 px-3 py-1.5 text-[#FF6961]">{activeCount} 单进行中</Badge>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="relative mx-auto max-w-[1600px] px-4 pb-16 sm:px-6 xl:px-8">
        <div className="sticky top-[76px] z-30 -mx-4 overflow-x-auto border-b border-white/[0.06] bg-[#090A0D]/84 px-4 py-3 backdrop-blur-xl scrollbar-none sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8">
          <TabsList variant="line" className="h-11 min-w-max gap-1 rounded-none bg-transparent p-0">
            {navItems.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="h-10 flex-none rounded-xl px-3.5 text-sm text-white/42 after:hidden hover:bg-white/[0.045] hover:text-white data-[state=active]:bg-white/[0.075] data-[state=active]:text-white sm:px-4">
                <Icon className="size-4" />{label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {error ? (
          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-[#FF453A]/25 bg-[#FF453A]/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#FF9A94]">{error}</p>
            <Button size="sm" variant="outline" disabled={isLoading} onClick={() => void load()} className="border-[#FF453A]/25 bg-transparent text-[#FF9A94] hover:bg-[#FF453A]/10 hover:text-white"><RefreshCw className={isLoading ? "animate-spin" : ""} />重试同步</Button>
          </div>
        ) : null}

        <TabsContent value="dashboard" className="pt-8"><Dashboard workers={workers} orders={orders} selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} /></TabsContent>
        <TabsContent value="orders" className="pt-8"><OrderDesk menu={menu} workers={workers} orders={orders} /></TabsContent>
        <TabsContent value="workers" className="pt-8"><WorkerBoard workers={workers} orders={orders} /></TabsContent>
        <TabsContent value="pricing" className="pt-8"><PriceMenuPanel menu={menu} /></TabsContent>
        <TabsContent value="history" className="pt-8"><HistoryPanel workers={workers} orders={orders} selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} /></TabsContent>
      </Tabs>
    </main>
  );
}
