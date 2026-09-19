"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UserPlus } from "lucide-react";
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
import type { WorkerTier, WorkerType } from "@/lib/club-types";
import { useClubStore } from "@/store/use-club-store";

const tiers: WorkerTier[] = ["1档", "2档", "3档"];
const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";

interface AddWorkerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddWorkerModal({ open, onOpenChange }: AddWorkerModalProps) {
  const addWorker = useClubStore((state) => state.addWorker);
  const isMutating = useClubStore((state) => state.is_mutating);
  const [name, setName] = useState("");
  const [tier, setTier] = useState<WorkerTier | null>("1档");
  const [workerType, setWorkerType] = useState<WorkerType>("standard");
  const [nameTouched, setNameTouched] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const trimmedName = name.trim();
  const nameError = nameTouched
    ? !trimmedName
      ? "请输入打手姓名"
      : Array.from(trimmedName).length > 20
        ? "姓名最多 20 个字符"
        : ""
    : "";

  function handleOpenChange(nextOpen: boolean) {
    if (!isMutating) onOpenChange(nextOpen);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameTouched(true);
    setSubmitError("");
    if (!trimmedName || Array.from(trimmedName).length > 20) return;

    try {
      const worker = await addWorker({ name: trimmedName, tier, workerType });
      toast.success(`${worker.name} 已加入打手看板`, { duration: 2500 });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "添加打手失败";
      setSubmitError(message);
      toast.error(message, { duration: 2500 });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!isMutating}
        className="overflow-hidden border-white/10 bg-[#171719]/90 p-0 text-white shadow-2xl backdrop-blur-xl sm:max-w-md"
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
              <UserPlus className="size-5" />
            </span>
            <DialogTitle className="text-xl">添加打手</DialogTitle>
            <DialogDescription className="text-white/45">
              新打手将以空闲状态加入看板，可立即参与派单。
            </DialogDescription>
          </DialogHeader>

          <label className="space-y-2" htmlFor="add-worker-name">
            <span className="flex items-center justify-between text-sm font-medium text-white/65">
              <span>姓名</span>
              <span className="text-[12px] font-normal text-white/30">{Array.from(name).length}/20</span>
            </span>
            <Input
              id="add-worker-name"
              value={name}
              maxLength={20}
              autoFocus
              placeholder="输入打手姓名"
              aria-invalid={Boolean(nameError || submitError)}
              aria-describedby={nameError || submitError ? "add-worker-error" : undefined}
              onBlur={() => setNameTouched(true)}
              onChange={(event) => {
                setName(event.target.value);
                setSubmitError("");
              }}
              className={inputClass}
            />
            {nameError || submitError ? (
              <p id="add-worker-error" role="alert" className="text-[13px] text-[#FF6961]">
                {nameError || submitError}
              </p>
            ) : null}
          </label>

          <div className="space-y-2">
            <label id="add-worker-type-label" className="text-sm font-medium text-white/65">
              打手类型
            </label>
            <Select
              value={workerType}
              onValueChange={(value) => {
                const nextType = value as WorkerType;
                setWorkerType(nextType);
                setTier(nextType === "entertainment" ? null : "1档");
              }}
            >
              <SelectTrigger
                aria-labelledby="add-worker-type-label"
                className={`${inputClass} w-full`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-[#242426] text-white">
                <SelectItem value="standard">普通打手</SelectItem>
                <SelectItem value="entertainment">娱乐陪玩</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <AnimatePresence initial={false}>
            {workerType === "standard" ? (
              <motion.div
                key="worker-tier"
                initial={{ opacity: 0, height: 0, y: -8 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -8 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                className="overflow-hidden"
              >
                <div className="space-y-2">
                  <label id="add-worker-tier-label" className="text-sm font-medium text-white/65">
                    档位
                  </label>
                  <Select value={tier ?? "1档"} onValueChange={(value) => setTier(value as WorkerTier)}>
                    <SelectTrigger
                      aria-labelledby="add-worker-tier-label"
                      className={`${inputClass} w-full`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-[#242426] text-white">
                      {tiers.map((item) => (
                        <SelectItem key={item} value={item}>{item}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </motion.div>
            ) : (
              <motion.p
                key="entertainment-note"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="rounded-xl border border-[#BF5AF2]/18 bg-[#BF5AF2]/[0.08] px-3 py-2 text-[13px] leading-5 text-[#D9A0FF]"
              >
                娱乐陪玩不设档位，可参与单人或双人平分订单；按档位抽成时使用专属比例。
              </motion.p>
            )}
          </AnimatePresence>

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
