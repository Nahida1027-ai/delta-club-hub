"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, PencilLine } from "lucide-react";
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
import type { Order } from "@/lib/club-types";
import {
  displayCompletedAt,
  displayCreatedAt,
  fallbackOrderNo,
} from "@/lib/order-presentation";
import { useClubStore } from "@/store/use-club-store";

const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";

function toShanghaiDateTimeInput(value: string | null | undefined) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function fromShanghaiDateTimeInput(value: string) {
  if (!value) return null;
  const timestamp = Date.parse(`${value}:00+08:00`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function EditOrderPresentationModal({
  order,
  open,
  onOpenChange,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateOrderTimeAndNo = useClubStore((state) => state.updateOrderTimeAndNo);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [orderNo, setOrderNo] = useState(() => order ? fallbackOrderNo(order) : "");
  const [createdInput, setCreatedInput] = useState(() =>
    order ? toShanghaiDateTimeInput(displayCreatedAt(order)) : "",
  );
  const [completedInput, setCompletedInput] = useState(() =>
    order ? toShanghaiDateTimeInput(displayCompletedAt(order)) : "",
  );
  const [error, setError] = useState("");

  if (!order) return null;

  async function save() {
    const currentOrder = order;
    if (!currentOrder) return;
    const displayCreatedAtValue = fromShanghaiDateTimeInput(createdInput);
    const displayCompletedAtValue = fromShanghaiDateTimeInput(completedInput);
    if (!displayCreatedAtValue) {
      setError("请选择有效的下单时间");
      return;
    }
    if (completedInput && !displayCompletedAtValue) {
      setError("请选择有效的完成时间");
      return;
    }
    if (displayCompletedAtValue && Date.parse(displayCompletedAtValue) < Date.parse(displayCreatedAtValue)) {
      setError("完成时间不能早于下单时间");
      return;
    }
    if (currentOrder.status === "completed" && !displayCompletedAtValue) {
      setError("已完成订单需要保留完成时间");
      return;
    }
    try {
      await updateOrderTimeAndNo(currentOrder.id, {
        custom_order_no: orderNo,
        display_created_at: displayCreatedAtValue,
        display_completed_at: displayCompletedAtValue,
      });
      toast.success("修改成功（不影响工资结算）");
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
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
            <DialogTitle className="flex items-center gap-2 text-xl"><PencilLine className="size-5 text-[#64D2FF]" />编辑订单展示信息</DialogTitle>
            <DialogDescription className="text-white/45">
              调整编号与展示时间，不会修改订单原始创建时间或工资结算归属。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div>
              <label htmlFor="edit-order-no" className="text-sm font-medium text-white/70">订单编号</label>
              <Input id="edit-order-no" value={orderNo} maxLength={30} onChange={(event) => setOrderNo(event.target.value)} className={`${inputClass} mt-2 font-mono`} />
            </div>
            <div>
              <label htmlFor="edit-display-created" className="text-sm font-medium text-white/70">展示下单时间</label>
              <Input id="edit-display-created" type="datetime-local" value={createdInput} onChange={(event) => setCreatedInput(event.target.value)} className={`${inputClass} mt-2 [color-scheme:dark]`} />
            </div>
            <div>
              <label htmlFor="edit-display-completed" className="text-sm font-medium text-white/70">展示完成时间</label>
              <Input id="edit-display-completed" type="datetime-local" value={completedInput} onChange={(event) => setCompletedInput(event.target.value)} className={`${inputClass} mt-2 [color-scheme:dark]`} />
              {order.status === "active" ? <p className="mt-1.5 text-xs text-white/32">进行中订单可暂时留空。</p> : null}
            </div>
          </div>

          <p className="rounded-xl border border-[#FF9F0A]/20 bg-[#FF9F0A]/10 px-3 py-2.5 text-xs leading-5 text-[#FFD08A]">
            注：修改时间仅影响展示、排序与导出；工资结算仍按原始创建时间归属周期。
          </p>
          {error ? <p className="rounded-xl border border-[#FF453A]/20 bg-[#FF453A]/10 px-3 py-2 text-sm text-[#FF6961]">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isMutating} onClick={() => onOpenChange(false)} className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white">取消</Button>
            <Button type="button" disabled={isMutating} onClick={() => void save()} className="h-11 rounded-xl bg-[#007AFF] text-white hover:bg-[#1685ff]">
              <Check className="size-4" />{isMutating ? "正在保存…" : "保存修改"}
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
