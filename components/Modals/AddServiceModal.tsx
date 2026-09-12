"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgePlus } from "lucide-react";
import { toast } from "sonner";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { CommissionMode, OrderType, PriceMenuItem, SplitType } from "@/lib/club-types";
import { useClubStore } from "@/store/use-club-store";

const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";

type FieldName =
  | "serviceName"
  | "price"
  | "hourlyRate"
  | "commission"
  | "tier1Commission"
  | "tier2Commission"
  | "tier3Commission"
  | "firstRatio"
  | "secondRatio";
type FieldErrors = Partial<Record<FieldName, string>>;

interface AddServiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddServiceModal({ open, onOpenChange }: AddServiceModalProps) {
  const addMenuItem = useClubStore((state) => state.addMenuItem);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [serviceName, setServiceName] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("escort");
  const [price, setPrice] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [commissionMode, setCommissionMode] = useState<CommissionMode>("uniform");
  const [commission, setCommission] = useState("0");
  const [tierCommissions, setTierCommissions] = useState({
    "1档": "0",
    "2档": "0",
    "3档": "0",
  });
  const [splitType, setSplitType] = useState<SplitType>("single");
  const [firstRatio, setFirstRatio] = useState("50");
  const [secondRatio, setSecondRatio] = useState("50");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState("");

  function handleOpenChange(nextOpen: boolean) {
    if (!isMutating) onOpenChange(nextOpen);
  }

  function validate(): FieldErrors {
    const nextErrors: FieldErrors = {};
    const numericPrice = Number(price);
    const numericHourlyRate = Number(hourlyRate);
    const numericCommission = Number(commission);
    const numericFirst = Number(firstRatio);
    const numericSecond = Number(secondRatio);

    if (!serviceName.trim()) nextErrors.serviceName = "请输入服务名称";
    if (orderType === "escort") {
      if (!price.trim()) {
        nextErrors.price = "请输入基础价格";
      } else if (!Number.isFinite(numericPrice) || Math.round(numericPrice * 100) <= 0) {
        nextErrors.price = "基础价格必须大于 0";
      }
    } else if (!hourlyRate.trim()) {
      nextErrors.hourlyRate = "请输入每小时价格";
    } else if (!Number.isFinite(numericHourlyRate) || Math.round(numericHourlyRate * 100) <= 0) {
      nextErrors.hourlyRate = "每小时价格必须大于 0";
    }
    if (commissionMode === "uniform") {
      if (!commission.trim()) {
        nextErrors.commission = "请输入俱乐部抽成";
      } else if (!Number.isFinite(numericCommission) || numericCommission < 0 || numericCommission > 100) {
        nextErrors.commission = "统一抽成必须在 0% 到 100% 之间";
      }
    } else {
      (["1档", "2档", "3档"] as const).forEach((tier, index) => {
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
    }
    return nextErrors;
  }

  function clearFieldError(field: FieldName) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError("");
    if (Object.values(nextErrors).some(Boolean)) return;

    const item: Omit<PriceMenuItem, "id"> = {
      service_name: serviceName.trim(),
      order_type: orderType,
      base_price: orderType === "escort" ? Number(price) : 0,
      hourly_rate: orderType === "companion" ? Number(hourlyRate) : 0,
      commission_mode: commissionMode,
      club_commission_rate: Number(commission),
      tier_commission_rates: {
        "1档": Number(tierCommissions["1档"]),
        "2档": Number(tierCommissions["2档"]),
        "3档": Number(tierCommissions["3档"]),
      },
      split_type: splitType,
      tiered_ratios: splitType === "tiered"
        ? { "1档": Number(firstRatio), "2档": Number(secondRatio) }
        : null,
      eligible_tiers: splitType === "tiered"
        ? ["1档", "2档"]
        : ["1档", "2档", "3档"],
    };

    try {
      const created = await addMenuItem(item);
      toast.success(`${created.service_name} 已加入价格表`, { duration: 2500 });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "添加服务失败";
      setSubmitError(message);
      toast.error(message, { duration: 2500 });
    }
  }

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
              <BadgePlus className="size-5" />
            </span>
            <DialogTitle className="text-xl">添加价格表服务</DialogTitle>
            <DialogDescription className="text-white/45">
              保存后会立即出现在老板点单区，后续新订单使用此规则快照。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="add-service-name" label="服务名称" error={errors.serviceName} className="sm:col-span-2">
              <Input
                id="add-service-name"
                value={serviceName}
                maxLength={60}
                autoFocus
                placeholder="例如：排位代练"
                aria-invalid={Boolean(errors.serviceName)}
                aria-describedby={errors.serviceName ? "add-service-name-error" : undefined}
                onChange={(event) => {
                  setServiceName(event.target.value);
                  clearFieldError("serviceName");
                }}
                className={inputClass}
              />
            </Field>

            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium text-white/65">订单类型</legend>
              <RadioGroup
                value={orderType}
                onValueChange={(value) => {
                  setOrderType(value as OrderType);
                  setErrors((current) => ({
                    ...current,
                    price: undefined,
                    hourlyRate: undefined,
                  }));
                  setSubmitError("");
                }}
                className="grid grid-cols-2 gap-2"
                aria-label="订单类型"
              >
                <label htmlFor="add-service-type-escort" className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${orderType === "escort" ? "border-[#007AFF]/50 bg-[#007AFF]/12 text-white" : "border-white/10 bg-white/[0.035] text-white/45 hover:bg-white/[0.06]"}`}>
                  <RadioGroupItem id="add-service-type-escort" value="escort" className="border-white/25 text-[#007AFF]" />
                  <span><span className="block font-medium">护航单</span><span className="mt-0.5 block text-[12px] opacity-60">按固定基础价格计费</span></span>
                </label>
                <label htmlFor="add-service-type-companion" className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${orderType === "companion" ? "border-[#30D158]/45 bg-[#30D158]/10 text-white" : "border-white/10 bg-white/[0.035] text-white/45 hover:bg-white/[0.06]"}`}>
                  <RadioGroupItem id="add-service-type-companion" value="companion" className="border-white/25 text-[#30D158]" />
                  <span><span className="block font-medium">陪玩单</span><span className="mt-0.5 block text-[12px] opacity-60">按小时价格 × 时长计费</span></span>
                </label>
              </RadioGroup>
            </fieldset>

            <AnimatePresence initial={false} mode="wait">
              {orderType === "escort" ? (
                <motion.div
                  key="escort-price"
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden sm:col-span-2"
                >
                  <Field id="add-service-price" label="基础价格（元）" error={errors.price}>
                    <div className="relative">
                      <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/35">¥</span>
                      <Input
                        id="add-service-price"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        step="0.01"
                        value={price}
                        placeholder="0.00"
                        aria-invalid={Boolean(errors.price)}
                        aria-describedby={errors.price ? "add-service-price-error" : undefined}
                        onChange={(event) => {
                          setPrice(event.target.value);
                          clearFieldError("price");
                        }}
                        className={`${inputClass} pl-8`}
                      />
                    </div>
                  </Field>
                </motion.div>
              ) : (
                <motion.div
                  key="companion-rate"
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden sm:col-span-2"
                >
                  <Field id="add-service-hourly-rate" label="每小时价格（元 / 小时）" error={errors.hourlyRate} tone="green">
                    <div className="relative">
                      <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/35">¥</span>
                      <Input
                        id="add-service-hourly-rate"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        step="0.01"
                        value={hourlyRate}
                        placeholder="0.00"
                        aria-invalid={Boolean(errors.hourlyRate)}
                        aria-describedby={errors.hourlyRate ? "add-service-hourly-rate-error" : undefined}
                        onChange={(event) => {
                          setHourlyRate(event.target.value);
                          clearFieldError("hourlyRate");
                        }}
                        className={`${inputClass} pl-8`}
                      />
                    </div>
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>

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
                <label
                  htmlFor="add-service-commission-uniform"
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${commissionMode === "uniform" ? "border-[#007AFF]/50 bg-[#007AFF]/12 text-white" : "border-white/10 bg-white/[0.035] text-white/45 hover:bg-white/[0.06]"}`}
                >
                  <RadioGroupItem id="add-service-commission-uniform" value="uniform" className="border-white/25 text-[#007AFF]" />
                  <span><span className="block font-medium">统一抽成</span><span className="mt-0.5 block text-[12px] opacity-60">所有档位使用同一比例</span></span>
                </label>
                <label
                  htmlFor="add-service-commission-by-tier"
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${commissionMode === "by_tier" ? "border-[#007AFF]/50 bg-[#007AFF]/12 text-white" : "border-white/10 bg-white/[0.035] text-white/45 hover:bg-white/[0.06]"}`}
                >
                  <RadioGroupItem id="add-service-commission-by-tier" value="by_tier" className="border-white/25 text-[#007AFF]" />
                  <span><span className="block font-medium">按档位抽成</span><span className="mt-0.5 block text-[12px] opacity-60">每个档位独立设置</span></span>
                </label>
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
                  <Field id="add-service-commission" label="俱乐部抽成（%）" error={errors.commission}>
                    <Input
                      id="add-service-commission"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={commission}
                      aria-invalid={Boolean(errors.commission)}
                      aria-describedby={errors.commission ? "add-service-commission-error" : undefined}
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
                    {(["1档", "2档", "3档"] as const).map((tier, index) => {
                      const field = `tier${index + 1}Commission` as
                        | "tier1Commission"
                        | "tier2Commission"
                        | "tier3Commission";
                      const id = `add-service-tier-${index + 1}-commission`;
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
                    <p className="text-[13px] leading-5 text-[#8FD3FF] sm:col-span-3">双人订单先平分订单金额，再从每名打手自己的份额中按其档位比例抽成。</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-2 sm:col-span-2">
              <label id="add-service-split-label" className="text-sm font-medium text-white/65">
                分配模式
              </label>
              <Select
                value={splitType}
                onValueChange={(value) => {
                  setSplitType(value as SplitType);
                  setErrors((current) => ({
                    ...current,
                    firstRatio: undefined,
                    secondRatio: undefined,
                  }));
                  setSubmitError("");
                }}
              >
                <SelectTrigger aria-labelledby="add-service-split-label" className={`${inputClass} w-full`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#242426] text-white">
                  <SelectItem value="single">单人全吃</SelectItem>
                  <SelectItem value="equal">两人平分</SelectItem>
                  <SelectItem value="tiered">按档位比例</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <AnimatePresence initial={false}>
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
                    <Field id="add-service-first-ratio" label="1档打手占比（%）" error={errors.firstRatio} tone="violet">
                      <Input
                        id="add-service-first-ratio"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max="99.99"
                        step="0.01"
                        value={firstRatio}
                        aria-invalid={Boolean(errors.firstRatio)}
                        aria-describedby={errors.firstRatio ? "add-service-first-ratio-error" : undefined}
                        onChange={(event) => {
                          setFirstRatio(event.target.value);
                          clearFieldError("firstRatio");
                        }}
                        className={inputClass}
                      />
                    </Field>
                    <Field id="add-service-second-ratio" label="2档打手占比（%）" error={errors.secondRatio} tone="violet">
                      <Input
                        id="add-service-second-ratio"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max="99.99"
                        step="0.01"
                        value={secondRatio}
                        aria-invalid={Boolean(errors.secondRatio)}
                        aria-describedby={errors.secondRatio ? "add-service-second-ratio-error" : undefined}
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
              ) : null}
            </AnimatePresence>
          </div>

          {submitError ? (
            <p role="alert" className="rounded-xl border border-[#FF3B30]/20 bg-[#FF3B30]/10 px-3 py-2 text-[13px] text-[#FF6961]">
              {submitError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={isMutating}
              onClick={() => onOpenChange(false)}
              className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={isMutating}
              className="h-11 rounded-xl bg-gradient-to-r from-[#007AFF] to-[#5AC8FA] text-white shadow-[0_10px_28px_rgba(0,122,255,.28)] hover:brightness-110"
            >
              {isMutating ? "正在添加…" : "确认添加"}
            </Button>
          </DialogFooter>
        </motion.form>
      </DialogContent>
    </Dialog>
  );
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
  tone?: "default" | "violet" | "blue" | "green";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <label htmlFor={id} className={`text-sm font-medium ${tone === "violet" ? "text-[#C4C3FF]" : tone === "blue" ? "text-[#8FD3FF]" : tone === "green" ? "text-[#7EF29A]" : "text-white/65"}`}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-[#FF6961]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
