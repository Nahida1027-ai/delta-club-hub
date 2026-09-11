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
import { Check, Minus, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  OrderPricingSnapshot,
  PriceMenuItem,
  SpecialRequirement,
  Worker,
  WorkerTier,
} from "@/lib/club-types";
import {
  buildPayoutWeights,
  calculateSettlement,
  defaultTierCommissionRates,
  fromCents,
  normalizeSpecialRequirements,
  specialRequirementsTotal,
  splitLabel,
  toCents,
} from "@/lib/settlement";
import { useClubStore } from "@/store/use-club-store";

interface RequirementDraft {
  id: string;
  name: string;
  price: string;
}

interface OrderConfirmModalProps {
  item: PriceMenuItem | null;
  workers: Worker[];
  initialWorkerIds?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";
function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(value);
}

function RollingMoney({ value }: { value: number }) {
  const reducedMotion = useReducedMotion();
  const source = useMotionValue(0);
  const spring = useSpring(source, { stiffness: 150, damping: 24, mass: 0.65 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    source.set(value);
  }, [source, value]);

  useMotionValueEvent(spring, "change", (latest) => setDisplay(latest));
  return <span>{formatMoney(reducedMotion ? value : display)}</span>;
}

function tierTone(tier: WorkerTier) {
  return {
    "1档": "border-[#FFD60A]/25 bg-[#FFD60A]/10 text-[#FFE36E]",
    "2档": "border-[#64D2FF]/25 bg-[#64D2FF]/10 text-[#8BE0FF]",
    "3档": "border-white/10 bg-white/[0.055] text-white/55",
  }[tier];
}

function newRequirement(): RequirementDraft {
  return { id: crypto.randomUUID(), name: "", price: "0" };
}

function parsedPrice(input: string) {
  if (!/^\d+(\.\d{0,2})?$/.test(input.trim())) return null;
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function OrderConfirmModal({
  item,
  workers,
  initialWorkerIds = [],
  open,
  onOpenChange,
}: OrderConfirmModalProps) {
  const createOrder = useClubStore((state) => state.createOrder);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [selected, setSelected] = useState<string[]>(initialWorkerIds);
  const [requirements, setRequirements] = useState<RequirementDraft[]>([]);
  const [attempted, setAttempted] = useState(false);

  const available = useMemo(
    () =>
      item
        ? workers.filter(
            (worker) => worker.status === "idle" && item.eligible_tiers.includes(worker.tier),
          )
        : [],
    [item, workers],
  );
  const needed = item?.split_type === "single" ? 1 : 2;
  const selectedIds = selected.filter((id) =>
    available.some((worker) => worker.id === id),
  );
  const selectedWorkers = available.filter((worker) => selectedIds.includes(worker.id));

  const requirementErrors = requirements.map((requirement) => {
    if (!requirement.name.trim()) return "请填写需求名称";
    if (Array.from(requirement.name.trim()).length > 60) return "需求名称最多 60 个字符";
    if (parsedPrice(requirement.price) === null) return "加钱金额需为非负数字，最多两位小数";
    return "";
  });

  const liveSpecialTotal = useMemo(() => {
    try {
      const cents = requirements.reduce((sum, requirement) => {
        const value = parsedPrice(requirement.price);
        return value === null ? sum : sum + toCents(value);
      }, 0);
      return fromCents(cents);
    } catch {
      return 0;
    }
  }, [requirements]);

  let validationMessage = "";
  let normalizedRequirements: SpecialRequirement[] = [];
  let preview: ReturnType<typeof calculateSettlement> | null = null;
  if (item) {
    try {
      if (selectedIds.length !== needed) throw new Error(`请选择 ${needed} 名打手`);
      normalizedRequirements = normalizeSpecialRequirements(
        requirements.map((requirement) => ({
          name: requirement.name,
          price: parsedPrice(requirement.price) ?? Number.NaN,
        })),
      );
      const specialTotal = specialRequirementsTotal(normalizedRequirements);
      const originalTotal = fromCents(toCents(item.base_price) + toCents(specialTotal));
      const snapshot: OrderPricingSnapshot = {
        service_name: item.service_name,
        base_price: item.base_price,
        commission_mode: item.commission_mode ?? "uniform",
        club_commission_rate: item.club_commission_rate,
        tier_commission_rates: {
          ...(item.tier_commission_rates ?? defaultTierCommissionRates()),
        },
        split_type: item.split_type,
        tiered_ratios: item.tiered_ratios,
        payout_weights: buildPayoutWeights(
          item.split_type,
          selectedWorkers,
          item.tiered_ratios,
        ),
      };
      preview = calculateSettlement(snapshot, 0, originalTotal);
    } catch (error) {
      validationMessage = error instanceof Error ? error.message : "订单信息不完整";
    }
  }

  if (!item) return null;

  function toggleWorker(id: string) {
    setSelected((current) => {
      const availableIds = new Set(available.map((worker) => worker.id));
      const validCurrent = current.filter((candidate) => availableIds.has(candidate));
      if (validCurrent.includes(id)) return validCurrent.filter((candidate) => candidate !== id);
      if (validCurrent.length >= needed) return item!.split_type === "single" ? [id] : validCurrent;
      return [...validCurrent, id];
    });
  }

  function updateRequirement(id: string, patch: Partial<RequirementDraft>) {
    setRequirements((current) =>
      current.map((requirement) =>
        requirement.id === id ? { ...requirement, ...patch } : requirement,
      ),
    );
  }

  async function confirm() {
    setAttempted(true);
    if (!preview || validationMessage || requirementErrors.some(Boolean)) return;
    try {
      const orderId = await createOrder(item!.id, selectedIds, normalizedRequirements);
      toast.success(`订单 ${orderId.slice(0, 8)} 已开始`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "派单失败");
    }
  }

  const orderTotal = fromCents(toCents(item.base_price) + toCents(liveSpecialTotal));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isMutating) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!isMutating}
        className="max-h-[92vh] overflow-y-auto border-white/10 bg-[#171719]/95 p-0 text-white shadow-[0_30px_100px_rgba(0,0,0,.55)] backdrop-blur-xl sm:max-w-2xl"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 27 }}
          className="grid gap-5 p-5 sm:p-6"
        >
          <DialogHeader>
            <DialogTitle className="text-xl">确认订单</DialogTitle>
            <DialogDescription className="text-white/45">
              核对加价与打手后再开始，价格和结算规则会在此刻冻结。
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-white">{item.service_name}</p>
              <p className="mt-1 text-sm text-white/40">{splitLabel(item.split_type)} · 基础价格</p>
            </div>
            <p className="shrink-0 text-xl font-semibold tracking-tight text-white">
              {formatMoney(item.base_price)}
            </p>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white/80">打手分配</h3>
                <p className="mt-1 text-xs text-white/35">已选择 {selectedIds.length}/{needed}</p>
              </div>
              <span className="rounded-lg bg-[#007AFF]/12 px-2.5 py-1 text-xs text-[#64D2FF]">
                {item.commission_mode === "by_tier" ? "按所选档位抽成" : "统一抽成"}
              </span>
            </div>
            {item.split_type === "tiered" ? (
              <p className="mb-3 rounded-xl border border-[#5E5CE6]/20 bg-[#5E5CE6]/10 px-3 py-2 text-xs leading-5 text-[#C4C3FF]">
                按档位分需各选 1 名 1档和 1 名 2档打手。
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {available.map((worker) => {
                const checked = selectedIds.includes(worker.id);
                const sameTierSelected = selectedWorkers.some(
                  (candidate) => candidate.tier === worker.tier,
                );
                const disabled =
                  !checked &&
                  (selectedIds.length >= needed ||
                    (item.split_type === "tiered" && sameTierSelected));
                const tierRate = item.tier_commission_rates?.[worker.tier] ?? 0;
                return (
                  <label
                    key={worker.id}
                    className={`flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                      checked
                        ? "border-[#007AFF]/55 bg-[#007AFF]/12"
                        : "border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.06]"
                    } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() => toggleWorker(worker.id)}
                      className="border-white/20 data-[state=checked]:border-[#007AFF] data-[state=checked]:bg-[#007AFF]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-white">{worker.name}</span>
                      <span className="mt-1 block text-xs text-white/38">
                        {item.commission_mode === "by_tier"
                          ? `该档抽成 ${tierRate}%`
                          : `累计 ${worker.total_completed_orders} 单`}
                      </span>
                    </span>
                    <span className={`rounded-lg border px-2 py-1 text-xs ${tierTone(worker.tier)}`}>
                      {worker.tier}
                    </span>
                  </label>
                );
              })}
            </div>
            {!available.length ? (
              <p className="mt-3 rounded-xl border border-[#FF453A]/20 bg-[#FF453A]/10 p-4 text-sm text-[#FF6961]">
                没有符合档位规则的空闲打手。
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-black/15 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white/80">
                  <Sparkles className="size-4 text-[#64D2FF]" />特殊需求（选填）
                </h3>
                <p className="mt-1 text-xs text-white/35">加价与基础价格一起参与抽成</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={requirements.length >= 20 || isMutating}
                onClick={() => setRequirements((current) => [...current, newRequirement()])}
                className="h-9 rounded-xl border-[#007AFF]/25 bg-[#007AFF]/10 text-[#64D2FF] hover:bg-[#007AFF]/20 hover:text-white"
              >
                <Plus className="size-3.5" />添加特殊需求
              </Button>
            </div>
            <AnimatePresence initial={false} mode="popLayout">
              {requirements.map((requirement, index) => (
                <motion.div
                  layout
                  key={requirement.id}
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 24, height: 0, marginTop: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                  className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_40px] sm:items-start"
                >
                  <div>
                    <label htmlFor={`requirement-name-${requirement.id}`} className="sr-only">
                      第 {index + 1} 条需求名称
                    </label>
                    <Input
                      id={`requirement-name-${requirement.id}`}
                      value={requirement.name}
                      maxLength={60}
                      placeholder="如：指定英雄"
                      onChange={(event) =>
                        updateRequirement(requirement.id, { name: event.target.value })
                      }
                      className={inputClass}
                      aria-invalid={Boolean(requirementErrors[index])}
                    />
                  </div>
                  <div>
                    <label htmlFor={`requirement-price-${requirement.id}`} className="sr-only">
                      第 {index + 1} 条加钱金额
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/35">¥</span>
                      <Input
                        id={`requirement-price-${requirement.id}`}
                        inputMode="decimal"
                        value={requirement.price}
                        placeholder="0"
                        onChange={(event) =>
                          updateRequirement(requirement.id, { price: event.target.value })
                        }
                        className={`${inputClass} pl-8`}
                        aria-invalid={Boolean(requirementErrors[index])}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`删除第 ${index + 1} 条特殊需求`}
                    onClick={() =>
                      setRequirements((current) =>
                        current.filter((candidate) => candidate.id !== requirement.id),
                      )
                    }
                    className="size-10 rounded-xl text-[#FF6961] hover:bg-[#FF3B30]/12 hover:text-white"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  {requirementErrors[index] ? (
                    <p className="text-xs text-[#FF6961] sm:col-span-3">{requirementErrors[index]}</p>
                  ) : null}
                </motion.div>
              ))}
            </AnimatePresence>
            {!requirements.length ? (
              <div className="mt-3 flex h-16 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-white/28">
                暂无特殊需求
              </div>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#007AFF]/20 bg-[#007AFF]/[0.07]">
            <div className="space-y-2 p-4 text-sm">
              <div className="flex items-center justify-between text-white/50">
                <span>基础价格</span><span>{formatMoney(item.base_price)}</span>
              </div>
              <div className="flex items-center justify-between text-white/50">
                <span>特殊需求加价</span><span>+{formatMoney(liveSpecialTotal)}</span>
              </div>
            </div>
            <div className="flex items-end justify-between gap-4 border-t border-[#007AFF]/15 bg-[#007AFF]/[0.06] px-4 py-4">
              <div>
                <p className="text-xs text-[#8EC9FF]">订单总价（不含打赏）</p>
                {preview ? (
                  <p className="mt-1 text-xs text-white/35">
                    预计俱乐部抽成 {formatMoney(preview.club_income)}
                  </p>
                ) : null}
              </div>
              <motion.p layout className="text-2xl font-semibold tracking-tight text-[#64D2FF]" aria-live="polite">
                <RollingMoney value={orderTotal} />
              </motion.p>
            </div>
          </section>

          {validationMessage && (attempted || selectedIds.length === needed) ? (
            <p className="rounded-xl border border-[#FF453A]/20 bg-[#FF453A]/10 px-3 py-2 text-sm text-[#FF6961]" role="alert">
              {validationMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={isMutating}
              className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!preview || isMutating || requirementErrors.some(Boolean)}
              onClick={confirm}
              className="h-11 rounded-xl bg-gradient-to-r from-[#007AFF] to-[#5AC8FA] px-5 text-white shadow-[0_10px_28px_rgba(0,122,255,.24)] hover:brightness-110"
            >
              {isMutating ? (
                <><Minus className="size-4 animate-pulse" />正在锁定…</>
              ) : (
                <><Check className="size-4" />确认开始</>
              )}
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
