"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CircleDollarSign, Settings2 } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CommissionMode,
  PriceMenuItem,
  SplitType,
  Worker,
  WorkerTier,
} from "@/lib/club-types";
import {
  buildPayoutWeights,
  calculateSettlement,
  validateMenuRule,
} from "@/lib/settlement";
import { useClubStore } from "@/store/use-club-store";

const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";
const tiers: WorkerTier[] = ["1档", "2档", "3档"];

type FieldName =
  | "serviceName"
  | "price"
  | "commission"
  | "tier1Commission"
  | "tier2Commission"
  | "tier3Commission"
  | "firstRatio"
  | "secondRatio"
  | "eligibleTiers";
type FieldErrors = Partial<Record<FieldName, string>>;

interface EditServiceModalProps {
  item: PriceMenuItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditServiceModal(props: EditServiceModalProps) {
  if (!props.item) return null;
  return (
    <EditServiceForm
      key={`${props.item.id}:${props.open ? "open" : "closed"}`}
      item={props.item}
      open={props.open}
      onOpenChange={props.onOpenChange}
    />
  );
}

function EditServiceForm({
  item,
  open,
  onOpenChange,
}: {
  item: PriceMenuItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateMenuItem = useClubStore((state) => state.updateMenuItem);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [serviceName, setServiceName] = useState(item.service_name);
  const [price, setPrice] = useState(String(item.base_price));
  const [commissionMode, setCommissionMode] = useState<CommissionMode>(
    item.commission_mode ?? "uniform",
  );
  const [commission, setCommission] = useState(String(item.club_commission_rate));
  const [tierCommissions, setTierCommissions] = useState({
    "1档": String(item.tier_commission_rates?.["1档"] ?? 0),
    "2档": String(item.tier_commission_rates?.["2档"] ?? 0),
    "3档": String(item.tier_commission_rates?.["3档"] ?? 0),
  });
  const [splitType, setSplitType] = useState<SplitType>(item.split_type);
  const [firstRatio, setFirstRatio] = useState(
    String(item.tiered_ratios?.["1档"] ?? 60),
  );
  const [secondRatio, setSecondRatio] = useState(
    String(item.tiered_ratios?.["2档"] ?? 40),
  );
  const [eligibleTiers, setEligibleTiers] = useState<WorkerTier[]>([
    ...item.eligible_tiers,
  ]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState("");

  function handleOpenChange(nextOpen: boolean) {
    if (!isMutating) onOpenChange(nextOpen);
  }

  function validate(): FieldErrors {
    const nextErrors: FieldErrors = {};
    const numericPrice = Number(price);
    const numericCommission = Number(commission);
    const numericFirst = Number(firstRatio);
    const numericSecond = Number(secondRatio);

    if (!serviceName.trim()) nextErrors.serviceName = "请输入服务名称";
    if (!price.trim()) {
      nextErrors.price = "请输入基础价格";
    } else if (!Number.isFinite(numericPrice) || Math.round(numericPrice * 100) <= 0) {
      nextErrors.price = "基础价格必须大于 0";
    }

    if (commissionMode === "uniform") {
      if (!commission.trim()) {
        nextErrors.commission = "请输入俱乐部抽成";
      } else if (
        !Number.isFinite(numericCommission) ||
        numericCommission < 0 ||
        numericCommission > 100
      ) {
        nextErrors.commission = "统一抽成必须在 0% 到 100% 之间";
      }
    } else {
      tiers.forEach((tier, index) => {
        const field = `tier${index + 1}Commission` as
          | "tier1Commission"
          | "tier2Commission"
          | "tier3Commission";
        const value = tierCommissions[tier];
        const numericValue = Number(value);
        if (!value.trim()) {
          nextErrors[field] = `请输入${tier}抽成`;
        } else if (!Number.isFinite(numericValue) || numericValue < 0) {
          nextErrors[field] = "抽成必须是非负数字";
        }
      });
    }

    if (splitType === "tiered") {
      if (!firstRatio.trim() || !Number.isFinite(numericFirst) || numericFirst <= 0) {
        nextErrors.firstRatio = "请输入大于 0 的占比";
      }
      if (!secondRatio.trim() || !Number.isFinite(numericSecond) || numericSecond <= 0) {
        nextErrors.secondRatio = "请输入大于 0 的占比";
      }
      if (
        !nextErrors.firstRatio &&
        !nextErrors.secondRatio &&
        Math.abs(numericFirst + numericSecond - 100) > 0.0001
      ) {
        nextErrors.secondRatio = "两档占比之和必须等于 100%";
      }
    } else if (!eligibleTiers.length) {
      nextErrors.eligibleTiers = "至少选择一个可接档位";
    }

    return nextErrors;
  }

  function clearFieldError(field: FieldName) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError("");
  }

  function buildItem(): PriceMenuItem {
    return {
      id: item.id,
      service_name: serviceName.trim(),
      base_price: Number(price),
      commission_mode: commissionMode,
      club_commission_rate: Number(commission),
      tier_commission_rates: {
        "1档": Number(tierCommissions["1档"]),
        "2档": Number(tierCommissions["2档"]),
        "3档": Number(tierCommissions["3档"]),
      },
      split_type: splitType,
      tiered_ratios:
        splitType === "tiered"
          ? { "1档": Number(firstRatio), "2档": Number(secondRatio) }
          : null,
      eligible_tiers:
        splitType === "tiered" ? ["1档", "2档"] : [...eligibleTiers],
    };
  }

  function toggleTier(tier: WorkerTier) {
    setEligibleTiers((current) =>
      current.includes(tier)
        ? current.filter((candidate) => candidate !== tier)
        : [...current, tier],
    );
    clearFieldError("eligibleTiers");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError("");
    if (Object.values(nextErrors).some(Boolean)) return;

    const nextItem = buildItem();
    try {
      validateMenuRule(nextItem);
      await updateMenuItem(nextItem);
      toast.success("结算规则已保存，仅作用于后续新订单", { duration: 2500 });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      setSubmitError(message);
      toast.error(message, { duration: 2500 });
    }
  }

  const preview = buildPreview(buildItem());

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!isMutating}
        className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#171719]/90 p-0 text-white shadow-2xl backdrop-blur-xl sm:max-w-2xl"
      >
        <motion.form
          onSubmit={submit}
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="grid gap-5 p-6"
        >
          <DialogHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-[#007AFF]/15 text-[#64D2FF]">
              <Settings2 className="size-5" />
            </span>
            <DialogTitle className="text-xl">编辑结算规则</DialogTitle>
            <DialogDescription className="text-white/45">
              已创建订单保留原规则快照，不会被本次修改影响。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="edit-service-name" label="服务名称" error={errors.serviceName} className="sm:col-span-2">
              <Input
                id="edit-service-name"
                value={serviceName}
                maxLength={60}
                autoFocus
                aria-invalid={Boolean(errors.serviceName)}
                aria-describedby={errors.serviceName ? "edit-service-name-error" : undefined}
                onChange={(event) => {
                  setServiceName(event.target.value);
                  clearFieldError("serviceName");
                }}
                className={inputClass}
              />
            </Field>

            <Field id="edit-service-price" label="基础价格（元）" error={errors.price} className="sm:col-span-2">
              <div className="relative">
                <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/35">¥</span>
                <Input
                  id="edit-service-price"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={price}
                  aria-invalid={Boolean(errors.price)}
                  aria-describedby={errors.price ? "edit-service-price-error" : undefined}
                  onChange={(event) => {
                    setPrice(event.target.value);
                    clearFieldError("price");
                  }}
                  className={`${inputClass} pl-8`}
                />
              </div>
            </Field>

            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium text-white/65">抽成模式</legend>
              <RadioGroup
                value={commissionMode}
                onValueChange={(value) => {
                  setCommissionMode(value as CommissionMode);
                  setErrors((current) => ({
                    ...current,
                    commission: undefined,
                    tier1Commission: undefined,
                    tier2Commission: undefined,
                    tier3Commission: undefined,
                  }));
                  setSubmitError("");
                }}
                className="grid grid-cols-2 gap-2"
                aria-label="抽成模式"
              >
                <CommissionModeOption
                  id="edit-service-commission-uniform"
                  value="uniform"
                  current={commissionMode}
                  title="统一抽成"
                  detail="所有档位使用同一比例"
                />
                <CommissionModeOption
                  id="edit-service-commission-by-tier"
                  value="by_tier"
                  current={commissionMode}
                  title="按档位抽成"
                  detail="每个档位独立设置"
                />
              </RadioGroup>
            </fieldset>

            <AnimatePresence initial={false} mode="wait">
              {commissionMode === "uniform" ? (
                <motion.div
                  key="uniform-commission"
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden sm:col-span-2"
                >
                  <Field id="edit-service-commission" label="俱乐部抽成（%）" error={errors.commission}>
                    <Input
                      id="edit-service-commission"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={commission}
                      aria-invalid={Boolean(errors.commission)}
                      aria-describedby={errors.commission ? "edit-service-commission-error" : undefined}
                      onChange={(event) => {
                        setCommission(event.target.value);
                        clearFieldError("commission");
                      }}
                      className={inputClass}
                    />
                  </Field>
                </motion.div>
              ) : (
                <motion.div
                  key="tier-commissions"
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden sm:col-span-2"
                >
                  <div className="grid gap-4 rounded-2xl border border-[#007AFF]/20 bg-[#007AFF]/[0.07] p-4 sm:grid-cols-3">
                    {tiers.map((tier, index) => {
                      const field = `tier${index + 1}Commission` as
                        | "tier1Commission"
                        | "tier2Commission"
                        | "tier3Commission";
                      const id = `edit-service-tier-${index + 1}-commission`;
                      return (
                        <Field key={tier} id={id} label={`${tier}打手抽成（%）`} error={errors[field]} tone="blue">
                          <Input
                            id={id}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={tierCommissions[tier]}
                            aria-invalid={Boolean(errors[field])}
                            aria-describedby={errors[field] ? `${id}-error` : undefined}
                            onChange={(event) => {
                              setTierCommissions((current) => ({ ...current, [tier]: event.target.value }));
                              clearFieldError(field);
                            }}
                            className={inputClass}
                          />
                        </Field>
                      );
                    })}
                    <p className="text-[13px] leading-5 text-[#8FD3FF] sm:col-span-3">双人订单会分别按两名打手的档位计提抽成，最终抽成比例为两档之和。</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-2 sm:col-span-2">
              <label id="edit-service-split-label" className="text-sm font-medium text-white/65">分配模式</label>
              <Select
                value={splitType}
                onValueChange={(value) => {
                  setSplitType(value as SplitType);
                  setErrors((current) => ({
                    ...current,
                    firstRatio: undefined,
                    secondRatio: undefined,
                    eligibleTiers: undefined,
                  }));
                  setSubmitError("");
                }}
              >
                <SelectTrigger aria-labelledby="edit-service-split-label" className={`${inputClass} w-full`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#242426] text-white">
                  <SelectItem value="single">单人全吃 · 1 名打手</SelectItem>
                  <SelectItem value="equal">两人平分 · 各 50%</SelectItem>
                  <SelectItem value="tiered">按档位分 · 1档 + 2档</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <AnimatePresence initial={false} mode="wait">
              {splitType === "tiered" ? (
                <motion.div
                  key="tiered-ratios"
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="overflow-hidden sm:col-span-2"
                >
                  <div className="grid gap-4 rounded-2xl border border-[#5E5CE6]/20 bg-[#5E5CE6]/[0.07] p-4 sm:grid-cols-2">
                    <Field id="edit-service-first-ratio" label="1档打手占比（%）" error={errors.firstRatio} tone="violet">
                      <Input
                        id="edit-service-first-ratio"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max="99.99"
                        step="0.01"
                        value={firstRatio}
                        aria-invalid={Boolean(errors.firstRatio)}
                        aria-describedby={errors.firstRatio ? "edit-service-first-ratio-error" : undefined}
                        onChange={(event) => {
                          setFirstRatio(event.target.value);
                          clearFieldError("firstRatio");
                        }}
                        className={inputClass}
                      />
                    </Field>
                    <Field id="edit-service-second-ratio" label="2档打手占比（%）" error={errors.secondRatio} tone="violet">
                      <Input
                        id="edit-service-second-ratio"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max="99.99"
                        step="0.01"
                        value={secondRatio}
                        aria-invalid={Boolean(errors.secondRatio)}
                        aria-describedby={errors.secondRatio ? "edit-service-second-ratio-error" : undefined}
                        onChange={(event) => {
                          setSecondRatio(event.target.value);
                          clearFieldError("secondRatio");
                        }}
                        className={inputClass}
                      />
                    </Field>
                    <p className={`text-[13px] sm:col-span-2 ${Math.abs(Number(firstRatio) + Number(secondRatio) - 100) <= 0.0001 ? "text-[#5FE778]" : "text-[#FF6961]"}`}>
                      当前合计 {Number(firstRatio || 0) + Number(secondRatio || 0)}%，必须等于 100%。
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.fieldset
                  key="eligible-tiers"
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="overflow-hidden sm:col-span-2"
                >
                  <legend className="mb-2 text-sm font-medium text-white/65">可接档位</legend>
                  <div className="flex flex-wrap gap-2">
                    {tiers.map((tier) => {
                      const checked = eligibleTiers.includes(tier);
                      return (
                        <label key={tier} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${checked ? "border-[#007AFF]/50 bg-[#007AFF]/12 text-white" : "border-white/10 bg-white/[0.035] text-white/45 hover:bg-white/[0.06]"}`}>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleTier(tier)}
                            className="border-white/20 data-[state=checked]:border-[#007AFF] data-[state=checked]:bg-[#007AFF]"
                          />
                          {tier}
                        </label>
                      );
                    })}
                  </div>
                  {errors.eligibleTiers ? <p role="alert" className="mt-2 text-[13px] text-[#FF6961]">{errors.eligibleTiers}</p> : null}
                </motion.fieldset>
              )}
            </AnimatePresence>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-white/65"><CircleDollarSign className="size-4 text-[#64D2FF]" />零打赏结算示例</span>
              {preview.tierLabel ? <span className="text-[12px] text-white/35">{preview.tierLabel}</span> : null}
            </div>
            {preview.result ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <PreviewCell label="订单总额" value={preview.result.total_pool} />
                <PreviewCell label="俱乐部" value={preview.result.club_income} tone="blue" />
                {preview.result.worker_incomes.map((income, index) => (
                  <PreviewCell key={income.workerId} label={`打手 ${index + 1}`} value={income.amount} tone="green" />
                ))}
              </div>
            ) : (
              <p className="text-[13px] leading-5 text-[#FF9A94]">{preview.error ?? "填写完整规则后显示预览"}</p>
            )}
          </div>

          {submitError ? (
            <p role="alert" className="rounded-xl border border-[#FF3B30]/20 bg-[#FF3B30]/10 px-3 py-2 text-[13px] text-[#FF6961]">{submitError}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isMutating} onClick={() => onOpenChange(false)} className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white">取消</Button>
            <Button type="submit" disabled={isMutating} className="h-11 rounded-xl bg-gradient-to-r from-[#007AFF] to-[#5AC8FA] text-white shadow-[0_10px_28px_rgba(0,122,255,.28)] hover:brightness-110">
              {isMutating ? "正在保存…" : "保存规则"}
            </Button>
          </DialogFooter>
        </motion.form>
      </DialogContent>
    </Dialog>
  );
}

function CommissionModeOption({
  id,
  value,
  current,
  title,
  detail,
}: {
  id: string;
  value: CommissionMode;
  current: CommissionMode;
  title: string;
  detail: string;
}) {
  return (
    <label htmlFor={id} className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${current === value ? "border-[#007AFF]/50 bg-[#007AFF]/12 text-white" : "border-white/10 bg-white/[0.035] text-white/45 hover:bg-white/[0.06]"}`}>
      <RadioGroupItem id={id} value={value} className="border-white/25 text-[#007AFF]" />
      <span><span className="block font-medium">{title}</span><span className="mt-0.5 block text-[12px] opacity-60">{detail}</span></span>
    </label>
  );
}

function buildPreview(item: PriceMenuItem) {
  try {
    validateMenuRule(item);
    const demoWorkers: Worker[] = item.split_type === "single"
      ? [{ id: "demo-1", name: "示例打手", tier: item.eligible_tiers[0] ?? "1档", status: "idle", total_completed_orders: 0 }]
      : item.split_type === "tiered"
        ? [
            { id: "demo-1", name: "1档打手", tier: "1档", status: "idle", total_completed_orders: 0 },
            { id: "demo-2", name: "2档打手", tier: "2档", status: "idle", total_completed_orders: 0 },
          ]
        : [
            { id: "demo-1", name: "打手 A", tier: item.eligible_tiers[0] ?? "1档", status: "idle", total_completed_orders: 0 },
            { id: "demo-2", name: "打手 B", tier: item.eligible_tiers[1] ?? item.eligible_tiers[0] ?? "1档", status: "idle", total_completed_orders: 0 },
          ];
    const payoutWeights = buildPayoutWeights(
      item.split_type,
      demoWorkers,
      item.tiered_ratios,
    );
    const result = calculateSettlement(
      {
        service_name: item.service_name,
        base_price: item.base_price,
        commission_mode: item.commission_mode,
        club_commission_rate: item.club_commission_rate,
        tier_commission_rates: item.tier_commission_rates,
        split_type: item.split_type,
        tiered_ratios: item.tiered_ratios,
        payout_weights: payoutWeights,
      },
      0,
      item.base_price,
    );
    return {
      result,
      error: null,
      tierLabel: item.commission_mode === "by_tier"
        ? `示例档位：${demoWorkers.map((worker) => worker.tier).join(" + ")}`
        : null,
    };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : "规则无效",
      tierLabel: null,
    };
  }
}

function PreviewCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "blue" | "green";
}) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-3">
      <p className="text-[12px] text-white/35">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${tone === "blue" ? "text-[#64D2FF]" : tone === "green" ? "text-[#5FE778]" : "text-white"}`}>{formatMoney(value)}</p>
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(value);
}

function Field({
  id,
  label,
  error,
  tone = "default",
  className = "",
  children,
}: {
  id: string;
  label: string;
  error?: string;
  tone?: "default" | "violet" | "blue";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <label htmlFor={id} className={`text-sm font-medium ${tone === "violet" ? "text-[#C4C3FF]" : tone === "blue" ? "text-[#8FD3FF]" : "text-white/65"}`}>{label}</label>
      {children}
      {error ? <p id={`${id}-error`} role="alert" className="text-[13px] text-[#FF6961]">{error}</p> : null}
    </div>
  );
}
