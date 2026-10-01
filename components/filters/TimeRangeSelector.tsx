"use client";

import { CalendarRange } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TimeRangeFilter, TimeRangePreset } from "@/lib/time-range";

const inputClass =
  "h-10 rounded-xl border-white/10 bg-white/[0.05] text-sm text-white shadow-none focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";

export function TimeRangeSelector({
  value,
  onChange,
  className = "",
}: {
  value: TimeRangeFilter;
  onChange: (value: TimeRangeFilter) => void;
  className?: string;
}) {
  function setPreset(preset: TimeRangePreset) {
    onChange({ ...value, preset });
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="flex h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-2 text-white/45">
        <CalendarRange className="size-4 text-[#64D2FF]" />
        <Select value={value.preset} onValueChange={(next) => setPreset(next as TimeRangePreset)}>
          <SelectTrigger className="h-8 min-w-28 border-0 bg-transparent px-1 text-sm text-white shadow-none hover:bg-transparent focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-[#242426] text-white">
            <SelectItem value="all">全部时间</SelectItem>
            <SelectItem value="today">今日</SelectItem>
            <SelectItem value="week">本周</SelectItem>
            <SelectItem value="month">本月</SelectItem>
            <SelectItem value="custom">自定义时间段</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <AnimatePresence initial={false}>
        {value.preset === "custom" ? (
          <motion.div
            initial={{ opacity: 0, width: 0, x: -8 }}
            animate={{ opacity: 1, width: "auto", x: 0 }}
            exit={{ opacity: 0, width: 0, x: -8 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="flex min-w-0 items-center gap-2 overflow-hidden"
          >
            <Input
              aria-label="筛选开始日期"
              type="date"
              value={value.from}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
              className={`${inputClass} w-36 [color-scheme:dark]`}
            />
            <span className="text-xs text-white/30">至</span>
            <Input
              aria-label="筛选结束日期"
              type="date"
              value={value.to}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
              className={`${inputClass} w-36 [color-scheme:dark]`}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
